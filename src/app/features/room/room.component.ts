import { Component, computed, inject } from '@angular/core';

import { MemoryService } from '../../core/memory/memory.service';
import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { RoomStore } from '../../store/room.store';

@Component({
  selector: 'app-room',
  standalone: true,
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss'
})
export class RoomComponent {
  readonly roomStore = inject(RoomStore);
  readonly characterStore = inject(CharacterStore);
  readonly chatStore = inject(ChatStore);
  private readonly memoryService = inject(MemoryService);

  readonly roomSummaries = computed(() => {
    const characterMap = this.characterStore.byId();
    return this.roomStore.rooms().map((room) => {
      const characterNames = room.characterIds.map(
        (id) => characterMap[id]?.name ?? id
      );
      const displayedCharacters = characterNames.slice(0, 3);
      const remaining = Math.max(0, characterNames.length - displayedCharacters.length);
      const characterSummary = characterNames.length
        ? `${displayedCharacters.join(' / ')}${remaining ? ` +${remaining}` : ''}`
        : '暂无角色';
      return {
        id: room.id,
        name: room.name,
        characterNames,
        characterSummary,
        characterCount: characterNames.length,
        messageCount: this.chatStore.messagesForRoom(room.id).length,
        memoryCount: this.memoryService.getRoomMemories(room.id).length
      };
    });
  });

  readonly activeRoom = this.roomStore.activeRoom;
  readonly activeSummary = computed(() => {
    const summaries = this.roomSummaries();
    const activeId = this.roomStore.activeRoomId();
    return summaries.find((summary) => summary.id === activeId) ?? summaries[0];
  });

  setActiveRoom(roomId: string): void {
    this.roomStore.setActiveRoom(roomId);
  }

  trackById(_index: number, room: { id: string }): string {
    return room.id;
  }
}
