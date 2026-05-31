import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { Character, Action, ExecutionPlan, Role } from '../../shared/types/chat.types';

const MIN_CONTENT_LENGTH_FOR_MEMORY = 20;

@Injectable({ providedIn: 'root' })
export class HaikuService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly chatStore: ChatStore
  ) {}

  createPlan(roomId: string, userContent: string): ExecutionPlan {
    const characters = this.characterStore.characters();
    const context = this.chatStore
      .messagesForRoom(roomId)
      .slice(-10)
      .map((message) => ({ role: message.role, content: message.content }));

    const actions: Action[] = [{ type: 'ui_event', event: 'typing' }];

    for (const character of characters) {
      const messages: Array<{ role: Role; content: string }> = [];
      const systemPrompt = this.buildSystemPrompt(character);

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      messages.push(...context);
      messages.push({ role: 'user', content: userContent });

      actions.push({
        type: 'call_model',
        characterId: character.id,
        provider: character.model.provider,
        model: character.model.model,
        temperature: character.model.temperature,
        messages
      });
    }

    if (userContent.length > MIN_CONTENT_LENGTH_FOR_MEMORY) {
      actions.push({
        type: 'write_memory',
        scope: 'room',
        targetId: roomId,
        content: userContent,
        importance: 0.6
      });
    }

    actions.push({ type: 'ui_event', event: 'stop_typing' });
    actions.push({ type: 'ui_event', event: 'end_turn' });

    console.groupCollapsed('[Haiku] ExecutionPlan');
    console.info('roomId', roomId);
    console.info('userContent', userContent);
    console.info('actions', actions);
    console.groupEnd();

    return {
      roomId,
      actions
    };
  }

  private buildSystemPrompt(character: Character): string {
    if (character.promptMode === 'advanced' && character.systemPrompt) {
      return character.systemPrompt;
    }

    // Auto mode: build from personality + background
    const parts: string[] = [`你是 ${character.name}。`];
    if (character.personality) {
      parts.push(`性格特点：${character.personality}。`);
    }
    if (character.background) {
      parts.push(`背景：${character.background}。`);
    }
    parts.push(
      '请以这个角色的身份和语气来回应，保持角色一致性。',
      '你的回答应该自然、有表现力，体现角色的独特性格和视角。'
    );

    return parts.join(' ');
  }
}
