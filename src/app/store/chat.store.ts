import { Injectable, computed, signal } from '@angular/core';

import { ChatMessage } from '../shared/types/chat.types';
import { createId } from '../shared/utils/id.util';

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly messagesSignal = signal<ChatMessage[]>([]);

  readonly messages = this.messagesSignal.asReadonly();
  readonly visibleMessages = computed(() =>
    [...this.messagesSignal()].sort((a: ChatMessage, b: ChatMessage) => a.createdAt - b.createdAt)
  );

  addUserMessage(roomId: string, content: string): ChatMessage {
    const message: ChatMessage = {
      id: createId(),
      roomId,
      role: 'user',
      senderId: 'user',
      content,
      createdAt: Date.now()
    };

    this.messagesSignal.update((messages) => [...messages, message]);
    return message;
  }

  addAiMessage(roomId: string, senderId: string, content: string): ChatMessage {
    const message: ChatMessage = {
      id: createId(),
      roomId,
      role: 'assistant',
      senderId,
      content,
      createdAt: Date.now()
    };

    this.messagesSignal.update((messages) => [...messages, message]);
    return message;
  }

  messagesForRoom(roomId: string): ChatMessage[] {
    return this.visibleMessages().filter((message: ChatMessage) => message.roomId === roomId);
  }
}
