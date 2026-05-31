import { Injectable } from '@angular/core';

import { ChatMessage } from '../../shared/types/chat.types';
import { StorageService } from '../storage/storage.service';

const POSITIVE_SIGNALS = [
  '谢谢', '感谢', '很棒', '厉害', '喜欢', '爱你', '赞', '❤', '哈哈',
  '有趣', '有意思', '没错', '同意', '确实', '太好了', '不错', '真好',
  'thanks', 'great', 'love', 'nice', 'agree', 'awesome', 'wow'
];

const NEGATIVE_SIGNALS = [
  '讨厌', '无聊', '烦死了', '滚', '垃圾', '很差', '恶心',
  'wrong', 'bad', 'boring', 'hate', 'terrible', 'stupid'
];

const BASE_AFFINITY = 0.2;
const REPLY_BONUS = 0.01;       // Per character reply
const POSITIVE_BONUS = 0.01;    // Per positive signal (capped per message)
const NEGATIVE_PENALTY = 0.03;  // Per negative signal (capped per message)
const MAX_SIGNAL_BONUS = 0.03;  // Max total signal bonus per message
const LONG_MESSAGE_BONUS = 0.01; // User long message → engaged
const NAME_MENTION_BONUS = 0.01; // User mentions character by name
const DECAY_RATE = 0.01;        // Per turn without interaction

@Injectable({ providedIn: 'root' })
export class UserAffinityService {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Evaluate user↔character affinity after a conversation turn.
   * Called by ExecutionEngine after each plan execution.
   */
  evaluate(
    characterIds: string[],
    recentMessages: ChatMessage[],
    characterNames: Map<string, string>
  ): void {
    if (!characterIds.length) return;

    const state = this.storageService.read();
    const affinity = { ...state.userAffinity };

    // Initialize any unseen characters
    for (const id of characterIds) {
      if (affinity[id] === undefined) affinity[id] = BASE_AFFINITY;
    }

    const userMessages = recentMessages.filter((m) => m.role === 'user');
    const aiMessages = recentMessages.filter(
      (m) => m.role === 'assistant' && characterIds.includes(m.senderId)
    );

    // ── 1. Reply bonus: character replied to user ───────────────
    for (const msg of aiMessages) {
      const prev = affinity[msg.senderId] ?? BASE_AFFINITY;
      affinity[msg.senderId] = this.clamp(prev + REPLY_BONUS);
    }

    // ── 2. User engagement analysis ────────────────────────────
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
        // Apply to all participating characters, capped per message
        const rawBonus = posCount * POSITIVE_BONUS - negCount * NEGATIVE_PENALTY;
        const capped = Math.max(-MAX_SIGNAL_BONUS, Math.min(MAX_SIGNAL_BONUS, rawBonus));
        for (const id of characterIds) {
          affinity[id] = this.clamp(affinity[id] + capped);
        }
      }
    }

    // ── 3. Decay: characters not in this turn slowly cool ──────
    const allIds = Object.keys(affinity);
    for (const id of allIds) {
      if (!characterIds.includes(id)) {
        affinity[id] = this.clamp(affinity[id] - DECAY_RATE);
      }
    }

    // ── Persist ────────────────────────────────────────────────
    state.userAffinity = affinity;
    this.storageService.write(state);

    console.info(
      '[Haiku-亲密度]',
      characterIds.map((id) => `${characterNames.get(id) ?? id}:${affinity[id]?.toFixed(2)}`).join(', ')
    );
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
