import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { EventBusService } from '../../core/event-bus/event-bus.service';
import { ChatOrchestratorService } from '../../core/engine/chat-orchestrator.service';
import { ChatStore } from '../../store/chat.store';
import { RoomStore } from '../../store/room.store';
import { UiStore } from '../../store/ui.store';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent {
  readonly roomStore = inject(RoomStore);
  readonly chatStore = inject(ChatStore);
  readonly uiStore = inject(UiStore);

  private readonly eventBus = inject(EventBusService);
  private readonly _orchestrator = inject(ChatOrchestratorService);

  readonly input = signal('');
  readonly currentMessages = computed(() => this.chatStore.messagesForRoom(this.roomStore.activeRoomId()));

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

  trackById(index: number, message: { id: string }): string {
    this._orchestrator;
    return `${index}-${message.id}`;
  }
}
