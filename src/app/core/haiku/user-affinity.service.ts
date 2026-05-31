import { Injectable } from '@angular/core';

import { ChatMessage } from '../../shared/types/chat.types';
import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { LlmService } from '../llm/llm.service';
import { StorageService } from '../storage/storage.service';

const BASE_AFFINITY = 0.2;
const DECAY_RATE = 0.01;

// ── Fallback keyword signals (used when LLM is unavailable) ──────────
const POSITIVE_SIGNALS = [
  '谢谢', '感谢', '很棒', '厉害', '喜欢', '爱你', '赞', '❤', '哈哈',
  '有趣', '有意思', '没错', '同意', '确实', '太好了', '不错', '真好',
  'thanks', 'great', 'love', 'nice', 'agree', 'awesome', 'wow'
];

const NEGATIVE_SIGNALS = [
  '讨厌', '无聊', '烦死了', '滚', '垃圾', '很差', '恶心',
  'wrong', 'bad', 'boring', 'hate', 'terrible', 'stupid'
];

const REPLY_BONUS = 0.01;
const POSITIVE_BONUS = 0.01;
const NEGATIVE_PENALTY = 0.03;
const MAX_SIGNAL_BONUS = 0.03;
const LONG_MESSAGE_BONUS = 0.01;
const NAME_MENTION_BONUS = 0.01;

// ── AI inference constants ───────────────────────────────────────────
const AI_CONTEXT_MESSAGE_COUNT = 30;   // Recent messages to feed into AI
const AI_PER_CHAR_MESSAGE_COUNT = 10;  // Messages per character in the prompt

@Injectable({ providedIn: 'root' })
export class UserAffinityService {
  constructor(
    private readonly storageService: StorageService,
    private readonly characterStore: CharacterStore,
    private readonly chatStore: ChatStore,
    private readonly llmService: LlmService
  ) {}

  /**
   * Evaluate user↔character affinity after a conversation turn.
   *
   * Primary path: Ask Haiku's AI model to infer intimacy from conversation.
   * Fallback path: If the LLM call fails (no API key, network error, etc.),
   *   falls back to keyword-based heuristic scoring.
   *
   * Called by ExecutionEngine after each plan execution.
   */
  async evaluate(
    roomId: string,
    characterIds: string[],
    characterNames: Map<string, string>
  ): Promise<void> {
    if (!characterIds.length) return;

    const state = this.storageService.read();
    const affinity = { ...state.userAffinity };

    // Initialize any unseen characters
    for (const id of characterIds) {
      if (affinity[id] === undefined) affinity[id] = BASE_AFFINITY;
    }

    // ── Try AI inference first ────────────────────────────────────
    const aiSucceeded = await this.tryAiInference(roomId, characterIds, characterNames, affinity);

    if (!aiSucceeded) {
      // Fallback: keyword-based heuristic
      const allMessages = this.chatStore.messagesForRoom(roomId);
      const recentMessages = allMessages.slice(-AI_CONTEXT_MESSAGE_COUNT);
      this.keywordEvaluate(characterIds, recentMessages, characterNames, affinity);
    }

    // ── Decay: characters not in this turn slowly cool ────────────
    const allIds = Object.keys(affinity);
    for (const id of allIds) {
      if (!characterIds.includes(id)) {
        affinity[id] = this.clamp(affinity[id] - DECAY_RATE);
      }
    }

    // ── Persist ───────────────────────────────────────────────────
    state.userAffinity = affinity;
    this.storageService.write(state);

    console.info(
      '[Haiku-亲密度]',
      characterIds.map((id) => `${characterNames.get(id) ?? id}:${affinity[id]?.toFixed(2)}`).join(', ')
    );
  }

  /**
   * Use Haiku's AI model to infer intimacy from conversation context.
   * Returns true if AI inference succeeded, false if fallback is needed.
   */
  private async tryAiInference(
    roomId: string,
    characterIds: string[],
    characterNames: Map<string, string>,
    affinity: Record<string, number>
  ): Promise<boolean> {
    const haikuChar = this.characterStore.characters().find((c) => c.isSystem);
    if (!haikuChar) return false;

    const state = this.storageService.read();
    const user = state.user;

    // Fetch recent messages for the room
    const allMessages = this.chatStore.messagesForRoom(roomId);
    const recentMessages = allMessages.slice(-AI_CONTEXT_MESSAGE_COUNT);

    // Build per-character conversation context
    const charContexts: string[] = [];
    for (const id of characterIds) {
      const name = characterNames.get(id) || id;
      const char = this.characterStore.getCharacter(id);
      const personality = char?.personality || '';

      // Extract messages relevant to this character: user messages + this character's replies
      const relevantMessages = recentMessages.filter(
        (m) => m.senderId === id || m.senderId === 'user'
      );

      const conversation = relevantMessages
        .slice(-AI_PER_CHAR_MESSAGE_COUNT)
        .map((m) => {
          const speaker = m.senderId === 'user' ? (user.name || '用户') : name;
          return `${speaker}: ${m.content.slice(0, 200)}`;
        })
        .join('\n');

      const currentScore = affinity[id] ?? BASE_AFFINITY;

      charContexts.push(
        `【${name}】性格：${personality.slice(0, 40) || '未知'} | 当前亲密度：${currentScore.toFixed(2)}\n` +
        `对话记录：\n${conversation || '(暂无对话)'}`
      );
    }

    const userContext = [
      user.name && `名字：${user.name}`,
      user.location && `位置：${user.location}`,
      user.background && `背景：${user.background}`
    ].filter(Boolean).join('，');

    const prompt = `你是「看不见的手」，负责客观评估用户与每个AI角色的亲密度。

${userContext ? `用户信息：${userContext}` : ''}

以下是与各角色的近期对话：

${charContexts.join('\n\n---\n\n')}

请根据对话内容，判断用户与每个角色的亲密度（0.0 = 完全陌生，1.0 = 极度亲密）。

评估维度：
- 对话深度：是否涉及个人话题、情感表达
- 互动质量：是否有信任、共鸣、幽默、冲突
- 关系进展：相比当前分数，关系是在升温还是降温
- 用户态度：用户是否对该角色表现出兴趣、依赖或疏远

输出纯JSON（不要markdown代码块，不要额外文字）：
{"scores":{"角色名1":0.XX,"角色名2":0.XX}}`;

    try {
      const response = await this.llmService.chat(haikuChar.model.provider, {
        model: haikuChar.model.model,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }]
      });

      // Parse JSON from response — find the first { } block
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[Haiku-亲密度] AI响应中未找到JSON，回退到关键词模式');
        return false;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.scores || typeof parsed.scores !== 'object') {
        console.warn('[Haiku-亲密度] AI响应JSON格式不正确，回退到关键词模式');
        return false;
      }

      // Apply AI-inferred scores
      let applied = 0;
      for (const [name, score] of Object.entries(parsed.scores)) {
        const id = characterIds.find((i) => characterNames.get(i) === name);
        if (id && typeof score === 'number' && !isNaN(score)) {
          affinity[id] = this.clamp(score);
          applied++;
        }
      }

      console.info(`[Haiku-亲密度] AI推理成功，更新了 ${applied}/${characterIds.length} 个角色的亲密度`);
      return applied > 0;
    } catch (err) {
      console.warn('[Haiku-亲密度] AI推理失败，回退到关键词模式:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Fallback: keyword-based heuristic evaluation.
   * Used when AI inference is unavailable (no API key, network error, etc.).
   */
  private keywordEvaluate(
    characterIds: string[],
    recentMessages: ChatMessage[],
    characterNames: Map<string, string>,
    affinity: Record<string, number>
  ): void {
    const userMessages = recentMessages.filter((m) => m.role === 'user');
    const aiMessages = recentMessages.filter(
      (m) => m.role === 'assistant' && characterIds.includes(m.senderId)
    );

    // Reply bonus: character replied to user
    for (const msg of aiMessages) {
      const prev = affinity[msg.senderId] ?? BASE_AFFINITY;
      affinity[msg.senderId] = this.clamp(prev + REPLY_BONUS);
    }

    // User engagement analysis
    for (const msg of userMessages) {
      const content = msg.content.toLowerCase();

      // Long message → engaged
      if (msg.content.length > 40) {
        for (const id of characterIds) {
          affinity[id] = this.clamp(affinity[id] + LONG_MESSAGE_BONUS);
        }
      }

      // Name mention → directed at that character
      for (const id of characterIds) {
        const name = characterNames.get(id)?.toLowerCase();
        if (name && content.includes(name)) {
          affinity[id] = this.clamp(affinity[id] + NAME_MENTION_BONUS);
        }
      }

      // Tone signals
      let posCount = 0;
      let negCount = 0;
      for (const signal of POSITIVE_SIGNALS) {
        if (content.includes(signal)) posCount++;
      }
      for (const signal of NEGATIVE_SIGNALS) {
        if (content.includes(signal)) negCount++;
      }

      if (posCount > 0 || negCount > 0) {
        const rawBonus = posCount * POSITIVE_BONUS - negCount * NEGATIVE_PENALTY;
        const capped = Math.max(-MAX_SIGNAL_BONUS, Math.min(MAX_SIGNAL_BONUS, rawBonus));
        for (const id of characterIds) {
          affinity[id] = this.clamp(affinity[id] + capped);
        }
      }
    }

    console.info('[Haiku-亲密度] 使用关键词模式（AI不可用）');
  }

  getAffinity(characterId: string): number {
    const state = this.storageService.read();
    return state.userAffinity[characterId] ?? BASE_AFFINITY;
  }

  getAllAffinity(): Record<string, number> {
    return { ...this.storageService.read().userAffinity };
  }

  private clamp(v: number): number {
    return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  }
}
