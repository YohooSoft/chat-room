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

    // ── Round 0: Sequential — each character responds to user ─────
    console.info('[DiscussionEngine] Round 0 — 顺序回复用户');
    const { searchHappened } = await this.runSequentialRound(
      activeSpeakers, otherNames, context, 0, userContent, userInfo, roomId
    );

    // If a character searched and presented results, STOP here.
    // Don't let other characters interrupt the search presentation.
    if (searchHappened) {
      console.info('[DiscussionEngine] 搜索已展示，跳过后续轮次');
      this.webSearchService.clearResults(roomId);
      return;
    }

    // ── Filter out silent characters for subsequent AI rounds ─────
    const responsiveSpeakers = activeSpeakers.filter((id) => {
      const last = [...context].reverse().find((e) => e.speakerName === charLookup[id]?.name);
      return last && !isTrivial(last.content);
    });

    if (responsiveSpeakers.length >= 2) {
      for (let round = 1; round <= MAX_AI_ROUNDS; round++) {
        console.info(`[DiscussionEngine] Round ${round}/${MAX_AI_ROUNDS} — AI 自由对话`);
        await this.runSequentialRound(
          responsiveSpeakers, otherNames, context, round, undefined, userInfo, roomId
        );
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
      console.warn(`[DiscussionEngine] ${character.name} 搜索决策调用失败，跳过搜索`);
      return null;
    }
  }

  /**
   * Fast keyword check to avoid unnecessary LLM calls for search decisions.
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

  /**
   * Run one sequential round of character responses.
   *
   * Returns `{ searchHappened: true }` if a character searched the web
   * and presented results — the caller should stop further rounds to
   * avoid other characters interrupting the search presentation.
   */
  private async runSequentialRound(
    speakers: string[],
    otherNames: string[],
    context: Array<{ role: Role; content: string; speakerName?: string }>,
    round: number,
    userContent: string | undefined,
    userInfo: string,
    roomId: string
  ): Promise<{ searchHappened: boolean }> {
    for (const speakerId of speakers) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) continue;

      const peers = otherNames.filter((n) => n !== character.name);
      const positionIndex = speakers.indexOf(speakerId);

      // ── Round 0: Character decides if they need web search ─────
      let searchContext = '';
      let didSearch = false;
      if (round === 0 && userContent) {
        const searchQuery = await this.decideSearchForCharacter(
          { name: character.name, personality: character.personality, model: character.model },
          userContent,
          userInfo
        );
        if (searchQuery) {
          const result = await this.webSearchService.search(roomId, searchQuery);
          if (result.formatted) {
            // Strong directive: character MUST present the search results to the user
            searchContext = `\n\n重要：你刚才在网上搜索了「${searchQuery}」，以下是搜索结果。请务必将你查到的关键信息完整地告诉用户，不要只说"我查到了"，而要具体说出查到的内容。可以自然地提及来源：\n${result.formatted}`;
            didSearch = true;
          }
        }
      }

      // ── Build system prompt ──────────────────────────────────────
      // Include message format instructions so the character can clearly
      // distinguish its own words from those of other characters.
      const formatHint = `\n\n【消息格式说明】对话历史中：\n- 标注"用户 说："的是用户（真人）的发言\n- 标注"某某 说："的是其他角色的发言\n- 没有标注前缀、直接放在 assistant 角色位置的是你自己之前说过的话\n请据此区分：不要重复别人的观点当作自己的，也不要否认自己刚说过的话。`;

      let systemMsg: string;
      if (round === 0) {
        if (positionIndex === 0) {
          systemMsg = `你是 ${character.name}。${userInfo}用户说：「${userContent || ''}」。请自然回应。${searchContext}${character.personality ? `\n性格：${character.personality}` : ''}${formatHint}`;
        } else {
          const prevNames = speakers.slice(0, positionIndex)
            .map((id) => this.characterStore.getCharacter(id)?.name).filter(Boolean).join('、');
          systemMsg = `你是 ${character.name}。${userInfo}用户说：「${userContent || ''}」。${prevNames} 已回应（见上文）。请自然接话。${searchContext}${character.personality ? `\n性格：${character.personality}` : ''}${formatHint}`;
        }
      } else {
        systemMsg = `你是 ${character.name}。你正在跟 ${peers.join('、')} 聊天。自然交流，像朋友一样。${round === 1 ? '刚聊起来，放轻松。' : '别重复老话题。'}${character.personality ? `\n性格：${character.personality}` : ''}${formatHint}`;
      }

      // Build messages with clear attribution so each character
      // can tell which messages are its own vs. from others.
      //
      // Rules:
      //  - Own past messages   → role: 'assistant' (native LLM self-recognition)
      //  - Other speakers      → role: 'user'     prefixed with "角色名 说："
      //  - Human user messages → role: 'user'     prefixed with "用户 说："
      //  - System messages     → role: 'system'   (via systemMsg)
      const messages: Array<{ role: Role; content: string }> = [
        { role: 'system', content: systemMsg },
        ...context.map((m) => {
          const isOwn = m.speakerName === character.name;
          const isUser = !m.speakerName; // user messages have no speakerName

          if (isOwn) {
            // Use 'assistant' role so the LLM naturally recognises these as its own output
            return { role: 'assistant' as Role, content: m.content };
          }
          if (isUser) {
            return { role: 'user' as Role, content: `用户 说：${m.content}` };
          }
          // Another character's message
          return { role: 'user' as Role, content: `${m.speakerName} 说：${m.content}` };
        })
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

      // ── If this character searched and presented results, ─────
      // STOP immediately. No more characters this round.
      // This ensures the search presentation is not interrupted.
      if (didSearch && !isTrivial(fullContent)) {
        console.info(`[DiscussionEngine] ${character.name} 已展示搜索结果，停止本轮后续角色`);
        return { searchHappened: true };
      }
    }

    return { searchHappened: false };
  }
}
