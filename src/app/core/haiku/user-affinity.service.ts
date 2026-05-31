import { Injectable } from '@angular/core';

import { ChatMessage } from '../../shared/types/chat.types';
import { StorageService } from '../storage/storage.service';

const POSITIVE_SIGNALS = [
  '谢谢', '感谢', '好', '棒', '厉害', '喜欢', '爱', '赞', '❤', '哈哈',
  '有趣', '有意思', '对', '没错', '同意', '确实', '太好了', '不错',
  'thanks', 'good', 'great', 'love', 'nice', 'yes', 'agree', 'awesome'
];

const NEGATIVE_SIGNALS = [
  '不', '错', '讨厌', '无聊', '烦', '滚', '垃圾', '差',
  'no', 'wrong', 'bad', 'boring', 'hate', 'terrible'
];

const BASE_AFFINITY = 0.2;
const REPLY_BONUS = 0.02;       // Per character reply
const POSITIVE_BONUS = 0.05;    // Per positive signal
const NEGATIVE_PENALTY = 0.06;  // Per negative signal
const LONG_MESSAGE_BONUS = 0.03; // User long message → engaged
const NAME_MENTION_BONUS = 0.04; // User mentions character by name
const DECAY_RATE = 0.005;       // Per turn without interaction

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
        // Apply to all participating characters
        for (const id of characterIds) {
          affinity[id] = this.clamp(
            affinity[id] + posCount * POSITIVE_BONUS - negCount * NEGATIVE_PENALTY
          );
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
