import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { LlmService } from '../llm/llm.service';

const MAX_SPEAKERS_PER_ROUND = 5;
const MAX_DISCUSSION_ROUNDS = 5;
const REPETITION_THRESHOLD = 0.85; // Only block near-identical messages

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore
  ) {}

  async run(roomId: string, round: number, speakers: string[]): Promise<void> {
    if (round > MAX_DISCUSSION_ROUNDS) {
      console.info(`[DiscussionEngine] 达到最大讨论轮次 ${MAX_DISCUSSION_ROUNDS}，停止讨论`);
      return;
    }

    // Round 1: all speakers participate. Later rounds: scale up to MAX_SPEAKERS_PER_ROUND.
    const speakerCount = Math.min(speakers.length, Math.max(1, Math.min(round + 1, MAX_SPEAKERS_PER_ROUND)));
    const activeSpeakers = speakers.slice(0, speakerCount);

    // Build context: tell each speaker who else is participating
    const otherNames = activeSpeakers
      .map((id) => this.characterStore.getCharacter(id)?.name)
      .filter(Boolean);

    for (const speakerId of activeSpeakers) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) continue;

      const peers = otherNames.filter((n) => n !== character.name);
      const systemMsg = peers.length
        ? `你正在与 ${peers.join('、')} 进行第 ${round} 轮对话。请直接回应他们，像真人对话一样自然交流，不要以"回复"开头。`
        : `讨论轮次 ${round}`;

      const messageId = this.chatStore.beginStreamingMessage(roomId, character.id);

      try {
        const stream = this.llmService.chatStream(character.model.provider, {
          model: character.model.model,
          temperature: character.model.temperature,
          messages: [{ role: 'system', content: systemMsg }]
        });

        let fullContent = '';
        for await (const chunk of stream) {
          fullContent += chunk;
          this.chatStore.appendStreamChunk(messageId, chunk);
        }

        // Guard: warn if similar to recent messages, but still show it
        if (this.isRepetitive(roomId, fullContent)) {
          console.info(
            `[DiscussionEngine] 角色 ${character.name} 与近期消息相似度较高（仍显示）`
          );
        }

        this.chatStore.finalizeStreamedMessage(messageId);
      } catch {
        this.chatStore.finalizeStreamedMessage(messageId);
      }
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
