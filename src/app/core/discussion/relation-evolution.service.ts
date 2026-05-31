import { Injectable } from '@angular/core';

import { Character, ChatMessage, Relation } from '../../shared/types/chat.types';
import { CharacterStore } from '../../store/character.store';

// ── Evolution Constants ────────────────────────────────────────────
const BASE_CLOSENESS_GAIN = 0.01; // Per co-appearance in a discussion
const CLOSENESS_DECAY_RATE = 0.005; // Per turn without interaction
const TRUST_GAIN_CONSENSUS = 0.02; // When characters agree
const TRUST_LOSS_CONFLICT = 0.03; // When characters disagree
const MENTION_BOOST = 0.015; // When one character mentions another
const MAX_RELATION_VALUE = 1.0;
const MIN_RELATION_VALUE = 0.0;

// Positive tone keywords (agreement, support)
const POSITIVE_TONE_KEYWORDS = [
  '同意', '赞同', '说得好', '有道理', '不错',
  'agree', 'good point', 'exactly', 'right', 'correct'
];

// Negative tone keywords (disagreement, criticism)
const NEGATIVE_TONE_KEYWORDS = [
  '不同意', '不对', '错误', '但是', '然而', '不过',
  'disagree', 'wrong', 'but', 'however', 'not quite', 'incorrect'
];

@Injectable({ providedIn: 'root' })
export class RelationEvolutionService {
  constructor(private readonly characterStore: CharacterStore) {}

  /**
   * Evolve relations based on a round of messages.
   * Called after each turn of model calls / discussion.
   *
   * @param messages - The recent messages from the turn
   * @param participants - Character IDs that participated this turn
   */
  evolve(messages: ChatMessage[], participants: string[]): void {
    if (participants.length < 2) return;

    const characterMap = this.characterStore.byId();

    // ── Co-appearance: increase closeness between participants ─────
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const a = participants[i];
        const b = participants[j];
        this.adjustCloseness(characterMap, a, b, BASE_CLOSENESS_GAIN);
        this.adjustCloseness(characterMap, b, a, BASE_CLOSENESS_GAIN);
      }
    }

    // ── Tone analysis: detect agreement/disagreement ───────────────
    const latestMessages = messages.filter((m) => m.role === 'assistant').slice(-participants.length);

    for (const msg of latestMessages) {
      const speakerId = msg.senderId;
      if (!participants.includes(speakerId)) continue;

      const toneScore = this.analyzeTone(msg.content);

      // Affect relations with other participants
      for (const otherId of participants) {
        if (otherId === speakerId) continue;

        if (toneScore > 0) {
          // Positive tone — increase trust
          this.adjustTrust(characterMap, otherId, speakerId, TRUST_GAIN_CONSENSUS);
        } else if (toneScore < 0) {
          // Negative tone — decrease trust
          this.adjustTrust(characterMap, otherId, speakerId, -TRUST_LOSS_CONFLICT);
        }
      }

      // ── Mention detection: if character A mentions character B ────
      for (const otherId of participants) {
        if (otherId === speakerId) continue;
        const otherChar = characterMap[otherId];
        if (otherChar && msg.content.includes(otherChar.name)) {
          this.adjustCloseness(characterMap, speakerId, otherId, MENTION_BOOST);
        }
      }
    }

    // ── Decay: characters not interacting slowly drift apart ───────
    this.applyDecay(characterMap, participants);
  }

  /**
   * Analyze the tone of a message.
   * Returns > 0 for positive/agreeing tone, < 0 for negative/disagreeing tone,
   * and 0 for neutral.
   */
  private analyzeTone(content: string): number {
    const lower = content.toLowerCase();
    let score = 0;

    for (const kw of POSITIVE_TONE_KEYWORDS) {
      if (lower.includes(kw)) score += 1;
    }
    for (const kw of NEGATIVE_TONE_KEYWORDS) {
      if (lower.includes(kw)) score -= 1;
    }

    // Normalize: cap at -2 ~ 2 range
    return Math.max(-2, Math.min(2, score));
  }

  /**
   * Adjust the closeness between two characters by delta.
   */
  private adjustCloseness(
    characterMap: Record<string, Character>,
    fromId: string,
    toId: string,
    delta: number
  ): void {
    const character = characterMap[fromId];
    if (!character) return;

    const current = character.relations[toId]?.closeness ?? 0.5;
    const next = this.clamp(current + delta, MIN_RELATION_VALUE, MAX_RELATION_VALUE);

    if (Math.abs(next - current) < 0.001) return;

    const nextRelations = { ...character.relations };
    nextRelations[toId] = {
      closeness: Math.round(next * 1000) / 1000,
      trust: character.relations[toId]?.trust ?? 0.5
    };

    this.characterStore.updateCharacter(fromId, { relations: nextRelations });
  }

  /**
   * Adjust the trust from one character to another by delta.
   */
  private adjustTrust(
    characterMap: Record<string, Character>,
    fromId: string,
    toId: string,
    delta: number
  ): void {
    const character = characterMap[fromId];
    if (!character) return;

    const current = character.relations[toId]?.trust ?? 0.5;
    const next = this.clamp(current + delta, MIN_RELATION_VALUE, MAX_RELATION_VALUE);

    if (Math.abs(next - current) < 0.001) return;

    const nextRelations = { ...character.relations };
    nextRelations[toId] = {
      closeness: character.relations[toId]?.closeness ?? 0.5,
      trust: Math.round(next * 1000) / 1000
    };

    this.characterStore.updateCharacter(fromId, { relations: nextRelations });
  }

  /**
   * Gradually reduce closeness between characters that didn't interact this turn.
   */
  private applyDecay(
    characterMap: Record<string, Character>,
    activeParticipants: string[]
  ): void {
    const allIds = Object.keys(characterMap);
    const inactiveIds = allIds.filter((id) => !activeParticipants.includes(id));

    for (const activeId of activeParticipants) {
      for (const inactiveId of inactiveIds) {
        const character = characterMap[activeId];
        const current = character?.relations[inactiveId]?.closeness;
        if (current === undefined || current <= 0.1) continue;

        const nextRelations = { ...character.relations };
        nextRelations[inactiveId] = {
          closeness: Math.round(Math.max(0.1, current - CLOSENESS_DECAY_RATE) * 1000) / 1000,
          trust: character.relations[inactiveId]?.trust ?? 0.5
        };

        this.characterStore.updateCharacter(activeId, { relations: nextRelations });
      }
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
