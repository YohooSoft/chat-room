import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { LlmService } from '../llm/llm.service';

const MAX_SPEAKERS_PER_ROUND = 5;
const MAX_DISCUSSION_ROUNDS = 5;
const REPETITION_THRESHOLD = 0.7;

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore
  ) {}

  async run(roomId: string, round: number, speakers: string[]): Promise<void> {
    // Guard: enforce maximum discussion rounds
    if (round > MAX_DISCUSSION_ROUNDS) {
      console.info(`[DiscussionEngine] 达到最大讨论轮次 ${MAX_DISCUSSION_ROUNDS}，停止讨论`);
      return;
    }

    const speakerCount = Math.max(1, Math.min(round, MAX_SPEAKERS_PER_ROUND));

    for (const speakerId of speakers.slice(0, speakerCount)) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) {
        continue;
      }

      const response = await this.llmService.chat(character.model.provider, {
        model: character.model.model,
        temperature: character.model.temperature,
        messages: [{ role: 'system', content: `讨论轮次 ${round}` }]
      });

      // Guard: skip messages that are too similar to recent ones
      if (this.isRepetitive(roomId, response.content)) {
        console.info(
          `[DiscussionEngine] 角色 ${character.name} 发言重复度过高，跳过此轮消息`
        );
        continue;
      }

      this.chatStore.addAiMessage(roomId, character.id, response.content);
    }
  }

  /**
   * Simple Jaccard-style word-level repetition check against the most recent
   * messages in the room. Returns true if the new content is too similar to
   * any recent message.
   */
  private isRepetitive(roomId: string, newContent: string): boolean {
    const recentMessages = this.chatStore
      .messagesForRoom(roomId)
      .filter((m) => m.role === 'assistant')
      .slice(-3);

    if (!recentMessages.length) {
      return false;
    }

    const newWords = this.tokenize(newContent);
    if (newWords.size === 0) {
      return false;
    }

    for (const msg of recentMessages) {
      const existingWords = this.tokenize(msg.content);
      if (existingWords.size === 0) {
        continue;
      }
      const intersection = new Set([...newWords].filter((w) => existingWords.has(w)));
      const union = new Set([...newWords, ...existingWords]);
      const similarity = intersection.size / union.size;
      if (similarity >= REPETITION_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  private tokenize(text: string): Set<string> {
    // Split on whitespace and punctuation, filter short tokens
    return new Set(
      text
        .toLowerCase()
        .split(/[\s，。！？、,.!?]+/)
        .filter((w) => w.length >= 2)
    );
  }
}
