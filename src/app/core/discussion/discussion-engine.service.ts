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

    // ── Build context: a clean transcript of who said what ──────────
    // Each entry keeps the original role + a speakerName label.
    // speakerName === undefined  → user message
    // speakerName === string     → AI character message
    //
    // Content is lightly cleaned: we only strip leading name-prefix
    // patterns that LLMs sometimes add (e.g. "张三："). New messages
    // are already cleaned at source; this is a safety net for old data.
    const context: Array<{ role: Role; content: string; speakerName?: string }> = roomMessages
      .slice(-12)
      .map((m) => ({
        role: m.role === 'user' ? ('user' as Role) : ('assistant' as Role),
        content: m.content
          .replace(/^\[.+?\][：:]\s*/, '')
          .replace(/^[一-鿿\w]{1,12}[：:]\s*/, ''),
        speakerName: m.senderId === 'user' ? undefined : charLookup[m.senderId]?.name
      }));

    const userInfo = this.buildUserInfo(userName, userLocation, userBackground);

    // ── Round 0: each character responds to user ──────────────────
    console.info('[DiscussionEngine] Round 0 — 角色回应');
    const { searchHappened } = await this.runConversationRound(
      activeSpeakers, otherNames, context, 0, userContent, userInfo, roomId, userName
    );

    if (searchHappened) {
      console.info('[DiscussionEngine] 搜索已展示，跳过后续轮次');
      this.webSearchService.clearResults(roomId);
      return;
    }

    // ── Filter responsive speakers for AI rounds ──────────────────
    const responsiveSpeakers = activeSpeakers.filter((id) => {
      const last = [...context].reverse().find((e) => e.speakerName === charLookup[id]?.name);
      return last && !isTrivial(last.content);
    });

    if (responsiveSpeakers.length >= 2) {
      for (let round = 1; round <= MAX_AI_ROUNDS; round++) {
        console.info(`[DiscussionEngine] Round ${round}/${MAX_AI_ROUNDS} — AI 自由聊天`);
        await this.runConversationRound(
          responsiveSpeakers, otherNames, context, round, undefined, userInfo, roomId, userName
        );
      }
      console.info('[DiscussionEngine] 完成，弹窗询问');
      this.uiStore.pauseDiscussion(roomId, speakers);
    }

    this.webSearchService.clearResults(roomId);
  }

  private buildUserInfo(name?: string, location?: string, background?: string): string {
    const parts: string[] = [];
    if (name) parts.push(`正在和你对话的用户叫「${name}」`);
    if (location) parts.push(`TA在「${location}」`);
    if (background) parts.push(`关于TA：${background}`);
    return parts.length ? parts.join('。') + '。' : '';
  }

  // ── Content cleaning ────────────────────────────────────────────

  /**
   * Strip any "name："/"name:"/"[name]：" prefix that the LLM may have
   * prepended to its own response. We do this BEFORE storing and before
   * pushing to context, so the stored data is always clean.
   *
   * The UI already displays {senderName} separately — a redundant prefix
   * in the content body would cause double-attribution.
   */
  private stripNamePrefix(content: string, ownName: string): string {
    let cleaned = content;

    // 1. Strip "[ownName]：" or "ownName：" at the very beginning
    const escaped = ownName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned
      .replace(new RegExp(`^\\[?${escaped}\\]?[：:]\\s*`), '')
      .trim();

    // 2. Strip any other "[name]：" or "name：" pattern at the beginning
    //    (LLM sometimes uses the user's name or gets confused)
    cleaned = cleaned
      .replace(/^\[.+?\][：:]\s*/, '')
      .replace(/^[一-鿿\w]{1,12}[：:]\s*/, '')
      .trim();

    return cleaned || content; // never return empty string
  }

  // ── Search decision (unchanged) ──────────────────────────────────

  private async decideSearchForCharacter(
    character: { name: string; personality: string; model: { provider: string; model: string } },
    userContent: string,
    userInfo: string
  ): Promise<string | null> {
    if (!this.hasSearchHint(userContent)) return null;

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

  // ══════════════════════════════════════════════════════════════════
  //  Core: run one conversation round
  // ══════════════════════════════════════════════════════════════════

  private async runConversationRound(
    speakers: string[],
    otherNames: string[],
    context: Array<{ role: Role; content: string; speakerName?: string }>,
    round: number,
    userContent: string | undefined,
    userInfo: string,
    roomId: string,
    userName?: string
  ): Promise<{ searchHappened: boolean }> {
    for (const speakerId of speakers) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) continue;

      const peers = otherNames.filter((n) => n !== character.name);
      const positionIndex = speakers.indexOf(speakerId);
      const userDisplayName = userName || '用户';

      // ── Search (round 0 only) ──────────────────────────────────
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
            searchContext = `\n\n重要：你刚才在网上搜索了「${searchQuery}」，以下是搜索结果。请务必将你查到的关键信息完整地告诉用户，不要只说"我查到了"，而要具体说出查到的内容。可以自然地提及来源：\n${result.formatted}`;
            didSearch = true;
          }
        }
      }

      // ── Build system prompt ────────────────────────────────────
      // Frame it as a real group chat, NOT a script or performance.

      // 1. Build a readable chat transcript of recent context
      const transcript = this.buildTranscript(context, character.name, userDisplayName, 10);

      // 2. Build system prompt based on round
      let systemMsg: string;
      if (round === 0) {
        systemMsg = this.buildRound0Prompt(
          character.name, character.personality, userInfo, userContent,
          userDisplayName, peers, positionIndex, speakers, transcript, searchContext
        );
      } else {
        systemMsg = this.buildAiRoundPrompt(
          character.name, character.personality, peers, round, transcript
        );
      }

      // ── Build messages for the LLM ─────────────────────────────
      // CRITICAL: the LLM must distinguish THREE kinds of messages:
      //  【真人用户】— the actual human being. This is who you respond TO.
      //  【群友】    — other AI characters. They are peers, NOT the user.
      //  assistant  — your own past messages (native self-recognition).
      //
      // All non-self messages use role='user' (API constraint), but the
      // 【真人用户】/【群友】 tags make the distinction unmistakable.
      const messages: Array<{ role: Role; content: string }> = [
        { role: 'system', content: systemMsg },
        ...context.map((m) => {
          const isOwn = m.speakerName === character.name;
          const isHuman = !m.speakerName;

          if (isOwn) {
            return { role: 'assistant' as Role, content: m.content };
          }
          if (isHuman) {
            return { role: 'user' as Role, content: `【真人用户】${userDisplayName}：${m.content}` };
          }
          return { role: 'user' as Role, content: `【群友】${m.speakerName}：${m.content}` };
        })
      ];

      // ── Call model ─────────────────────────────────────────────
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

        // ── Clean: strip any "name：" prefix the LLM may have added ──
        // This ensures stored content is clean and consistent with the
        // UI (which already shows senderName separately).
        fullContent = this.stripNamePrefix(fullContent, character.name);

        if (isTrivial(fullContent)) {
          console.info(`[DiscussionEngine] ${character.name} 沉默（内容过短）`);
        } else {
          // Replace store content with cleaned version before persisting
          this.chatStore.setStreamingContent(messageId, fullContent);
          this.chatStore.finalizeStreamedMessage(messageId);
        }
      } catch (err) {
        this.chatStore.appendStreamChunk(messageId, `[错误] ${err instanceof Error ? err.message : '请求失败'}`);
        this.chatStore.finalizeStreamedMessage(messageId);
      }

      // Push cleaned content to context for subsequent speakers
      context.push({
        role: 'assistant' as Role,
        speakerName: character.name,
        content: fullContent
      });

      if (didSearch && !isTrivial(fullContent)) {
        console.info(`[DiscussionEngine] ${character.name} 已展示搜索结果，停止本轮后续角色`);
        return { searchHappened: true };
      }
    }

    return { searchHappened: false };
  }

  // ══════════════════════════════════════════════════════════════════
  //  Prompt builders
  // ══════════════════════════════════════════════════════════════════

  /**
   * Build a readable chat transcript for the system prompt.
   * Uses 【真人用户】/【群友】 markers so the character can
   * instantly see who is the human vs who is another AI.
   */
  private buildTranscript(
    context: Array<{ content: string; speakerName?: string }>,
    currentCharName: string,
    userDisplayName: string,
    maxEntries: number
  ): string {
    const recent = context.slice(-maxEntries);
    if (!recent.length) return '（暂无聊天记录）';

    return recent
      .map((m) => {
        if (!m.speakerName) {
          // Human user — this is who you primarily respond to
          return `【真人用户】${userDisplayName}：${m.content}`;
        }
        if (m.speakerName === currentCharName) {
          // Your own past messages
          return `你（${currentCharName}）：${m.content}`;
        }
        // Another AI — a peer, NOT the user
        return `【群友】${m.speakerName}：${m.content}`;
      })
      .join('\n');
  }

  /**
   * Round 0: character responds to the user's message.
   */
  private buildRound0Prompt(
    name: string,
    personality: string,
    userInfo: string,
    userContent: string | undefined,
    userDisplayName: string,
    peers: string[],
    positionIndex: number,
    speakers: string[],
    transcript: string,
    searchContext: string
  ): string {
    const personalityLine = personality ? `\n你的性格特点：${personality}` : '';
    const userLine = userContent ? `\n${userDisplayName}刚说：「${userContent}」` : '';

    let prompt = `你叫「${name}」，你正在一个群聊中。

【如何看懂对话记录】
- 标注「【真人用户】」的 → 这是群聊里唯一的真人，你应该主要回应TA
- 标注「【群友】」的 → 这是其他AI角色，和你一样是群聊参与者，TA们不是真人用户
- 标注「你（${name}）：」的 → 这是你自己之前说过的话
- 放在 assistant 位置但没有前缀的 → 也是你自己之前说过的话
请务必区分清楚：不要把其他群友说的话当成真人用户的话！

${userInfo ? userInfo + '\n' : ''}${personalityLine}${userLine}`;

    if (positionIndex > 0) {
      const prevSpeakers = speakers.slice(0, positionIndex)
        .map((id) => this.characterStore.getCharacter(id)?.name).filter(Boolean);
      if (prevSpeakers.length) {
        prompt += `\n在你之前，${prevSpeakers.join('、')} 已经回应了（见下方聊天记录）。`;
      }
    }

    prompt += `\n\n=== 聊天记录 ===
${transcript}
=== 记录结束 ===

现在轮到你了。请像真人聊天一样自然地回应。注意：
- 不要重复别人已经说过的观点，除非你要表示赞同或反对
- 如果你在记录中看到自己已经回应过了，就说点新的，不要再说一遍${searchContext}

请直接说话，不要加任何前缀。`;

    return prompt;
  }

  /**
   * Round 1-5: AI-to-AI free conversation.
   */
  private buildAiRoundPrompt(
    name: string,
    personality: string,
    peers: string[],
    round: number,
    transcript: string
  ): string {
    const personalityLine = personality ? `\n你的性格：${personality}` : '';
    const peerList = peers.length ? peers.join('、') : '其他人';

    const roundHint = round === 1
      ? '刚刚聊起来，放轻松，像朋友群聊一样。'
      : round >= 4
        ? '聊了一阵了。如果话题聊干了可以自然地换个新话题，或者沉默也没关系。'
        : '继续自然聊天。';

    return `你在一个群聊中，房间里还有：${peerList}。${personalityLine}

【如何看懂对话记录】
- 标注「【真人用户】」的 → 群聊里唯一的真人，TA说的话优先级最高
- 标注「【群友】」的 → 其他AI角色，和你一样是参与者，不是真人
- 标注「你（${name}）：」的 → 你自己之前说过的话
- 放在 assistant 位置但没有前缀的 → 也是你自己说过的话
记住：不要把群友说的话当成了真人用户的话！

${roundHint}

=== 聊天记录 ===
${transcript}
=== 记录结束 ===

现在轮到你了。像真人一样聊天：可以接话、提问、反驳、开玩笑、分享想法。如果你没什么想说的，可以简单回应或换话题。不要像写剧本一样说话。

请直接说话，不要加任何前缀。`;
  }
}
