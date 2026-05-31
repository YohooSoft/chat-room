import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { UiStore } from '../../store/ui.store';
import { LlmService } from '../llm/llm.service';
import { UserAffinityService } from '../haiku/user-affinity.service';
import { WebSearchService } from '../search/web-search.service';
import { Role } from '../../shared/types/chat.types';

const MAX_SPEAKERS_PER_ROUND = 5;
const MAX_AI_ROUNDS = 5;

function isTrivial(content: string): boolean {
  return content.replace(/[。.！!？?\s]+/g, '').length < 2;
}

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore,
    private readonly uiStore: UiStore,
    private readonly affinityService: UserAffinityService,
    private readonly webSearchService: WebSearchService
  ) {}

  async run(
    roomId: string,
    _round: number,
    speakers: string[],
    userContent?: string,
    userName?: string,
    userLocation?: string,
    userBackground?: string
  ): Promise<void> {
    const activeSpeakers = speakers.slice(0, MAX_SPEAKERS_PER_ROUND);
    if (!activeSpeakers.length) return;

    const roomMessages = this.chatStore.messagesForRoom(roomId);
    const charLookup = this.characterStore.byId();
    const otherNames = activeSpeakers
      .map((id) => this.characterStore.getCharacter(id)?.name)
      .filter((n): n is string => !!n);

    // Shared context: each speaker sees all previous speakers' output
    const context: Array<{ role: Role; content: string; speakerName?: string }> = roomMessages
      .slice(-8)
      .map((m) => ({
        role: m.role === 'user' ? ('user' as Role) : ('assistant' as Role),
        content: m.content.replace(/\[.+?\][：:]\s*/g, '').replace(/([一-鿿\w]+[：:]){1,3}\s*/g, ''),
        speakerName: m.senderId === 'user' ? undefined : charLookup[m.senderId]?.name
      }));

    // ── Build user info string ──────────────────────────────────────
    const userInfo = this.buildUserInfo(userName, userLocation, userBackground);

    // ── Round 0: Sequential — each character decides if they're addressed ──
    console.info('[DiscussionEngine] Round 0 — 顺序回复用户');
    await this.runSequentialRound(activeSpeakers, otherNames, context, 0, userContent, userInfo, roomId);

    // ── Filter out silent characters for subsequent AI rounds ─────
    const responsiveSpeakers = activeSpeakers.filter((id) => {
      const last = [...context].reverse().find((e) => e.speakerName === charLookup[id]?.name);
      return last && !isTrivial(last.content);
    });

    if (responsiveSpeakers.length >= 2) {
      for (let round = 1; round <= MAX_AI_ROUNDS; round++) {
        console.info(`[DiscussionEngine] Round ${round}/${MAX_AI_ROUNDS} — AI 自由对话`);
        await this.runSequentialRound(responsiveSpeakers, otherNames, context, round, undefined, userInfo, roomId);
      }
      console.info('[DiscussionEngine] 完成，弹窗询问');
      this.uiStore.pauseDiscussion(roomId, speakers);
    }

    // Clean up search results after discussion ends
    this.webSearchService.clearResults(roomId);
  }

  /**
   * Build a concise user info string for the system prompt.
   * Only includes fields the user has actually filled in.
   */
  private buildUserInfo(name?: string, location?: string, background?: string): string {
    const parts: string[] = [];
    if (name) parts.push(`正在和你对话的用户叫「${name}」`);
    if (location) parts.push(`TA在「${location}」`);
    if (background) parts.push(`关于TA：${background}`);
    return parts.length ? parts.join('。') + '。' : '';
  }

  /**
   * Ask the character's own LLM whether it needs to search the web.
   * Returns a search query string, or null if search is unnecessary.
   *
   * This is intentionally a separate, lightweight LLM call so each character
   * independently decides — not the Haiku scheduler.
   */
  private async decideSearchForCharacter(
    character: { name: string; personality: string; model: { provider: string; model: string } },
    userContent: string,
    userInfo: string
  ): Promise<string | null> {
    // Fast-path keyword check: skip LLM call for obviously non-search queries
    if (!this.hasSearchHint(userContent)) {
      return null;
    }

    const decisionPrompt = `你是 ${character.name}。${userInfo ? userInfo + '。' : ''}${character.personality ? `性格：${character.personality}。` : ''}

用户刚说：「${userContent}」

你需要搜索网络获取最新信息来回答吗？
- 如果用户问的是实时信息（新闻、天气、时事、具体事实查询等），回答：搜索|关键词
- 如果只是日常聊天、情感交流、角色扮演，回答：不需要

只回答"搜索|关键词"或"不需要"。`;

    try {
      const response = await this.llmService.chat(character.model.provider, {
        model: character.model.model,
        temperature: 0,
        messages: [{ role: 'user', content: decisionPrompt }]
      });

      const text = response.content.trim();
      if (text.startsWith('搜索') && text.includes('|')) {
        const query = text.split('|')[1]?.trim() || userContent;
        console.info(`[DiscussionEngine] ${character.name} 决定搜索: "${query}"`);
        return query;
      }

      console.info(`[DiscussionEngine] ${character.name} 决定不搜索`);
      return null;
    } catch {
      // Decision LLM call failed — skip search gracefully
      console.warn(`[DiscussionEngine] ${character.name} 搜索决策调用失败，跳过搜索`);
      return null;
    }
  }

  /**
   * Fast keyword check to avoid unnecessary LLM calls for search decisions.
   * Only returns true if the user message contains hints that search might help.
   */
  private hasSearchHint(content: string): boolean {
    const triggers = [
      '搜索', '查一下', '查查', '搜一下', '帮我查',
      '最新', '新闻', '今天', '现在', '天气',
      'news', 'latest', 'current', 'today', 'what is', 'who is',
      '?', '？', '吗', '呢', '什么', '谁', '哪里', '怎么',
    ];
    const lower = content.toLowerCase();
    return triggers.some(t => lower.includes(t));
  }

  private async runSequentialRound(
    speakers: string[],
    otherNames: string[],
    context: Array<{ role: Role; content: string; speakerName?: string }>,
    round: number,
    userContent: string | undefined,
    userInfo: string,
    roomId: string
  ): Promise<void> {
    for (const speakerId of speakers) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) continue;

      const peers = otherNames.filter((n) => n !== character.name);
      const positionIndex = speakers.indexOf(speakerId);

      // ── Round 0: Character decides if they need web search ─────
      let searchContext = '';
      if (round === 0 && userContent) {
        const searchQuery = await this.decideSearchForCharacter(
          { name: character.name, personality: character.personality, model: character.model },
          userContent,
          userInfo
        );
        if (searchQuery) {
          const result = await this.webSearchService.search(roomId, searchQuery);
          if (result.formatted) {
            searchContext = `\n\n以下是从网络搜索到的信息，可供参考：\n${result.formatted}`;
          }
        }
      }

      // Build system prompt
      let systemMsg: string;
      if (round === 0) {
        if (positionIndex === 0) {
          systemMsg = `你是 ${character.name}。${userInfo}用户说：「${userContent || ''}」。请自然回应。${searchContext}${character.personality ? `\n性格：${character.personality}` : ''}`;
        } else {
          const prevNames = speakers.slice(0, positionIndex)
            .map((id) => this.characterStore.getCharacter(id)?.name).filter(Boolean).join('、');
          systemMsg = `你是 ${character.name}。${userInfo}用户说：「${userContent || ''}」。${prevNames} 已回应（见上文）。请自然接话。${searchContext}${character.personality ? `\n性格：${character.personality}` : ''}`;
        }
      } else {
        systemMsg = `你是 ${character.name}。你正在跟 ${peers.join('、')} 聊天。自然交流，像朋友一样。${round === 1 ? '刚聊起来，放轻松。' : '别重复老话题。'}${character.personality ? `\n性格：${character.personality}` : ''}`;
      }

      // Build messages: all context → role:'user' so AI doesn't confuse identity
      const messages: Array<{ role: Role; content: string }> = [
        { role: 'system', content: systemMsg },
        ...context.map((m) => ({
          role: 'user' as Role,
          content: m.speakerName && m.speakerName !== character.name
            ? `${m.speakerName} 说：${m.content}`
            : m.content
        }))
      ];

      // ── Call model ──────────────────────────────────────────
      const messageId = this.chatStore.beginStreamingMessage(roomId, character.id);
      let fullContent = '';

      try {
        const stream = this.llmService.chatStream(character.model.provider, {
          model: character.model.model,
          temperature: character.model.temperature,
          messages
        });

        for await (const chunk of stream) {
          fullContent += chunk;
          this.chatStore.appendStreamChunk(messageId, chunk);
        }

        // Finalize only if meaningful response
        if (isTrivial(fullContent)) {
          console.info(`[DiscussionEngine] ${character.name} 沉默（内容过短）`);
        } else {
          this.chatStore.finalizeStreamedMessage(messageId);
        }
      } catch (err) {
        this.chatStore.appendStreamChunk(messageId, `[错误] ${err instanceof Error ? err.message : '请求失败'}`);
        this.chatStore.finalizeStreamedMessage(messageId);
      }

      // Push to context for subsequent speakers
      context.push({
        role: 'assistant' as Role,
        speakerName: character.name,
        content: fullContent
      });
    }
  }
}
