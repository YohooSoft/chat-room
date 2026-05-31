import { Injectable, computed, signal } from '@angular/core';

import { ChatMessage } from '../shared/types/chat.types';
import { createId } from '../shared/utils/id.util';
import { StorageService } from '../core/storage/storage.service';

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly messagesSignal = signal<ChatMessage[]>([]);

  readonly messages = this.messagesSignal.asReadonly();
  readonly visibleMessages = computed(() =>
    [...this.messagesSignal()].sort((a: ChatMessage, b: ChatMessage) => a.createdAt - b.createdAt)
  );

  constructor(private readonly storageService: StorageService) {
    this.hydrate();
  }

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
    this.persist(message);
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
    this.persist(message);
    return message;
  }

  /**
   * Create a placeholder message for streaming. Returns its ID.
   * The message will have empty content initially; appendStreamChunk
   * builds it up, and finalizeStreamedMessage persists it.
   */
  beginStreamingMessage(roomId: string, senderId: string): string {
    const id = createId();
    const placeholder: ChatMessage = {
      id,
      roomId,
      role: 'assistant',
      senderId,
      content: '',
      createdAt: Date.now()
    };
    this.messagesSignal.update((messages) => [...messages, placeholder]);
    return id;
  }

  /**
   * Append a chunk of text to a streaming message.
   */
  appendStreamChunk(messageId: string, chunk: string): void {
    this.messagesSignal.update((messages) =>
      messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + chunk } : m
      )
    );
  }

  /**
   * Finalize a streaming message — persist it to localStorage.
   */
  finalizeStreamedMessage(messageId: string): void {
    const message = this.messagesSignal().find((m) => m.id === messageId);
    if (message && message.content) {
      this.persist(message);
    }
  }

  messagesForRoom(roomId: string): ChatMessage[] {
    return this.visibleMessages().filter((message: ChatMessage) => message.roomId === roomId);
  }

  private hydrate(): void {
    const state = this.storageService.read();
    const messages = Object.values(state.messages).flat();
    this.messagesSignal.set(messages);
  }

  private persist(message: ChatMessage): void {
    const state = this.storageService.read();
    const roomMessages = state.messages[message.roomId] ?? [];
    state.messages[message.roomId] = [...roomMessages, message];
    this.storageService.write(state);
  }
}
