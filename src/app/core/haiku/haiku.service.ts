import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { Action, ExecutionPlan } from '../../shared/types/chat.types';

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
      actions.push({
        type: 'call_model',
        characterId: character.id,
        provider: character.model.provider,
        model: character.model.model,
        temperature: character.model.temperature,
        messages: [...context, { role: 'user', content: userContent }]
      });
    }

    if (userContent.length > 20) {
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

    return {
      roomId,
      actions
    };
  }
}
