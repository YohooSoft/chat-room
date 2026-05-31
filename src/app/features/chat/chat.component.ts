import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { MarkdownPipe } from '../../shared/utils/markdown.pipe';

import { EventBusService } from '../../core/event-bus/event-bus.service';
import { ChatOrchestratorService } from '../../core/engine/chat-orchestrator.service';
import { LlmService } from '../../core/llm/llm.service';
import { ChatStore } from '../../store/chat.store';
import { CharacterStore } from '../../store/character.store';
import { RoomStore } from '../../store/room.store';
import { UiStore } from '../../store/ui.store';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, RouterLink, MarkdownPipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent {
  readonly roomStore = inject(RoomStore);
  readonly chatStore = inject(ChatStore);
  readonly uiStore = inject(UiStore);
  readonly characterStore = inject(CharacterStore);
  private readonly llmService = inject(LlmService);

  private readonly eventBus = inject(EventBusService);
  private readonly orchestrator = inject(ChatOrchestratorService);

  readonly input = signal('');
  readonly typingLabel = '系统';
  readonly showCreateRoom = signal(false);
  readonly newRoomName = signal('');
  readonly newRoomCharacterIds = signal<string[]>([]);
  readonly usingMockMode = computed(() => !this.llmService.hasAnyApiKey());
  readonly currentMessages = computed(() =>
    this.chatStore.messagesForRoom(this.roomStore.activeRoomId())
  );
  readonly visibleCharacterCount = computed(() => {
    const room = this.roomStore.activeRoom();
    return room.characterIds.filter((id) => id !== 'haiku').length;
  });

  /** Non-system characters available to add to a new room. */
  readonly newRoomAvailableCharacters = computed(() =>
    this.characterStore.characters().filter((c) => !c.isSystem)
  );

  senderName(senderId: string): string {
    if (senderId === 'user') return '你';
    return this.characterStore.byId()[senderId]?.name ?? senderId;
  }

  constructor() {
    this.orchestrator.init();
  }

  switchRoom(roomId: string): void {
    this.roomStore.setActiveRoom(roomId);
  }

  toggleCreateRoom(): void {
    const show = !this.showCreateRoom();
    this.showCreateRoom.set(show);
    if (show) {
      this.newRoomName.set('');
      this.newRoomCharacterIds.set([...this.roomStore.activeRoom().characterIds]);
    }
  }

  toggleNewRoomCharacter(characterId: string): void {
    this.newRoomCharacterIds.update((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId]
    );
  }

  createRoom(): void {
    const name = this.newRoomName().trim();
    if (!name) {
      return;
    }
    const room = this.roomStore.createRoom(name, this.newRoomCharacterIds());
    this.showCreateRoom.set(false);
    this.roomStore.setActiveRoom(room.id);
  }

  submit(): void {
    const content = this.input().trim();
    if (!content) {
      return;
    }

    const roomId = this.roomStore.activeRoomId();
    this.chatStore.addUserMessage(roomId, content);
    this.eventBus.emit({
      type: 'user_message',
      roomId,
      content
    });
    this.input.set('');
  }

  trackById(_index: number, message: { id: string }): string {
    return message.id;
  }
}
