import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { UiStore } from '../../store/ui.store';
import { LlmService } from '../llm/llm.service';
import { Role } from '../../shared/types/chat.types';

const MAX_SPEAKERS_PER_ROUND = 5;
const MAX_TOTAL_ROUNDS = 5;

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore,
    private readonly uiStore: UiStore
  ) {}

  /**
   * Run multi-round AI-to-AI discussion.
   * Each round: every speaker takes one turn, seeing all previous messages.
   * After MAX_TOTAL_ROUNDS rounds, pauses and shows a modal asking the user
   * whether to continue.
   */
  async run(roomId: string, _round: number, speakers: string[]): Promise<void> {
    const speakerCount = Math.min(speakers.length, MAX_SPEAKERS_PER_ROUND);
    const activeSpeakers = speakers.slice(0, speakerCount);
    if (activeSpeakers.length < 2) return;

    const otherNames = activeSpeakers
      .map((id) => this.characterStore.getCharacter(id)?.name)
      .filter(Boolean);

    // Build initial context from recent room messages
    const roomMessages = this.chatStore.messagesForRoom(roomId);
    const context: Array<{ role: Role; content: string }> = roomMessages
      .slice(-8)
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as Role) : ('user' as Role),
        content: m.senderId === 'user' ? m.content : `[${m.senderId}]: ${m.content}`
      }));

    for (let round = 1; round <= MAX_TOTAL_ROUNDS; round++) {
      console.info(`[DiscussionEngine] AI 对话第 ${round}/${MAX_TOTAL_ROUNDS} 轮`);

      for (const speakerId of activeSpeakers) {
        const character = this.characterStore.getCharacter(speakerId);
        if (!character) continue;

        const peers = otherNames.filter((n) => n !== character.name);
        const systemMsg = peers.length
          ? `你是 ${character.name}。这是 AI 对话第 ${round} 轮，你正在与 ${peers.join('、')} 交流。请以 ${character.name} 的身份自然回应，像真人对话一样。${character.personality ? `你的性格：${character.personality}` : ''}`
          : `你是 ${character.name}。讨论轮次 ${round}。`;

        const messages: Array<{ role: Role; content: string }> = [
          { role: 'system', content: systemMsg },
          ...context,
          { role: 'user' as Role, content: `请以 ${character.name} 的身份回应。` }
        ];

        const messageId = this.chatStore.beginStreamingMessage(roomId, character.id);

        try {
          const stream = this.llmService.chatStream(character.model.provider, {
            model: character.model.model,
            temperature: character.model.temperature,
            messages
          });

          let fullContent = '';
          for await (const chunk of stream) {
            fullContent += chunk;
            this.chatStore.appendStreamChunk(messageId, chunk);
          }

          this.chatStore.finalizeStreamedMessage(messageId);

          // Append to rolling context so the NEXT speaker sees this
          context.push({
            role: 'assistant' as Role,
            content: `[${character.name}]: ${fullContent}`
          });
        } catch {
          this.chatStore.finalizeStreamedMessage(messageId);
        }
      }
    }

    // All rounds complete — pause and ask user
    console.info(`[DiscussionEngine] ${MAX_TOTAL_ROUNDS} 轮完成，弹窗询问`);
    this.uiStore.pauseDiscussion(roomId, speakers);
  }
}
