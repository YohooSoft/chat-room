import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MemoryService } from '../../core/memory/memory.service';
import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { RoomStore } from '../../store/room.store';

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './room.component.html',
  styleUrl: './room.component.scss'
})
export class RoomComponent {
  readonly roomStore = inject(RoomStore);
  readonly characterStore = inject(CharacterStore);
  readonly chatStore = inject(ChatStore);
  private readonly memoryService = inject(MemoryService);

  readonly editName = signal('');
  readonly editCharacterIds = signal<string[]>([]);
  readonly newRoomName = signal('');
  readonly newRoomCharacterIds = signal<string[]>([]);

  readonly roomSummaries = computed(() => {
    const characterMap = this.characterStore.byId();
    return this.roomStore.rooms().map((room) => {
      const characterNames = room.characterIds.map(
        (id) => characterMap[id]?.name ?? id
      );
      const displayedCharacters = characterNames.slice(0, 3);
      const remaining = Math.max(0, characterNames.length - 3);
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
    if (!summaries.length) {
      return undefined;
    }
    const activeId = this.roomStore.activeRoomId();
    return summaries.find((summary) => summary.id === activeId) ?? summaries[0];
  });

  constructor() {
    effect(() => {
      const active = this.roomStore.activeRoom();
      if (!active) {
        return;
      }
      this.editName.set(active.name);
      this.editCharacterIds.set([...active.characterIds]);
    });
  }

  setActiveRoom(roomId: string): void {
    this.roomStore.setActiveRoom(roomId);
  }

  toggleEditCharacter(characterId: string): void {
    this.editCharacterIds.update((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId]
    );
  }

  toggleNewCharacter(characterId: string): void {
    this.newRoomCharacterIds.update((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId]
    );
  }

  saveActiveRoom(): void {
    const roomId = this.roomStore.activeRoomId();
    const name = this.editName().trim();
    if (!roomId || !name) {
      return;
    }
    this.roomStore.updateRoom(roomId, {
      name,
      characterIds: this.editCharacterIds()
    });
  }

  createRoom(): void {
    const name = this.newRoomName().trim();
    if (!name) {
      return;
    }
    const room = this.roomStore.createRoom(name, this.newRoomCharacterIds());
    this.newRoomName.set('');
    this.newRoomCharacterIds.set([]);
    this.roomStore.setActiveRoom(room.id);
  }

  trackById(_index: number, room: { id: string }): string {
    return room.id;
  }
}
