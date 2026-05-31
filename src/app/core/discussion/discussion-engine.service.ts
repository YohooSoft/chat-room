import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { LlmService } from '../llm/llm.service';
import { Role } from '../../shared/types/chat.types';

const MAX_SPEAKERS_PER_ROUND = 5;
const MAX_DISCUSSION_ROUNDS = 5;

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
      this.chatStore.addAiMessage(roomId, '系统', `讨论已达 ${MAX_DISCUSSION_ROUNDS} 轮上限。发送任意内容继续对话。`);
      return;
    }

    const speakerCount = Math.min(speakers.length, Math.max(1, Math.min(round + 1, MAX_SPEAKERS_PER_ROUND)));
    const activeSpeakers = speakers.slice(0, speakerCount);

    // Gather room context so each speaker knows the conversation history
    const roomMessages = this.chatStore.messagesForRoom(roomId);
    const recentContext: Array<{ role: Role; content: string }> = roomMessages
      .slice(-6)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' as Role : 'user' as Role,
        content: m.senderId === 'user' ? m.content : `[${m.senderId}]: ${m.content}`
      }));

    const otherNames = activeSpeakers
      .map((id) => this.characterStore.getCharacter(id)?.name)
      .filter(Boolean);

    for (const speakerId of activeSpeakers) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) continue;

      const peers = otherNames.filter((n) => n !== character.name);
      const systemMsg = peers.length
        ? `你是 ${character.name}。现在进入 AI 之间的自由讨论环节（第 ${round} 轮），你正在与 ${peers.join('、')} 对话。请以 ${character.name} 的身份自然交流，像真人对话一样，不要扮演其他角色，不要以"${character.name}："开头。${character.personality ? `你的性格：${character.personality}` : ''}`
        : `你是 ${character.name}。讨论轮次 ${round}。`;

      const messages: Array<{ role: Role; content: string }> = [
        { role: 'system', content: systemMsg },
        ...recentContext,
        { role: 'user' as Role, content: peers.length ? `请以 ${character.name} 的身份回应。` : '请回应。' }
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

        // Append this speaker's message to the rolling context for the next speaker
        recentContext.push({ role: 'assistant' as Role, content: `[${character.name}]: ${fullContent}` });
      } catch {
        this.chatStore.finalizeStreamedMessage(messageId);
      }
    }
  }
}
