import { Component, computed, effect, inject, signal } from '@angular/core';

import { MemoryService } from '../../core/memory/memory.service';
import { MemoryRecord } from '../../shared/types/chat.types';
import { CharacterStore } from '../../store/character.store';
import { RoomStore } from '../../store/room.store';

@Component({
  selector: 'app-memory',
  standalone: true,
  templateUrl: './memory.component.html',
  styleUrl: './memory.component.scss'
})
export class MemoryComponent {
  readonly roomStore = inject(RoomStore);
  readonly characterStore = inject(CharacterStore);
  private readonly memoryService = inject(MemoryService);

  readonly rooms = this.roomStore.rooms;
  readonly characters = this.characterStore.characters;

  readonly scope = signal<'room' | 'character'>('room');
  readonly selectedRoomId = signal<string>(this.roomStore.activeRoomId());
  readonly selectedCharacterId = signal<string>(this.characters()[0]?.id ?? '');

  readonly currentMemories = computed(() => {
    const scope = this.scope();
    const memories =
      scope === 'room'
        ? this.memoryService.getRoomMemories(this.selectedRoomId())
        : this.memoryService.getCharacterMemories(this.selectedCharacterId());
    return [...memories].sort((a, b) => b.createdAt - a.createdAt);
  });

  readonly currentTargetName = computed(() => {
    if (this.scope() === 'room') {
      return (
        this.rooms().find((room) => room.id === this.selectedRoomId())?.name ?? '未选择房间'
      );
    }
    return (
      this.characters().find((character) => character.id === this.selectedCharacterId())?.name ??
      '未选择角色'
    );
  });

  constructor() {
    effect(() => {
      const rooms = this.rooms();
      const currentId = this.selectedRoomId();
      if (!rooms.length) {
        return;
      }
      if (!currentId || !rooms.some((room) => room.id === currentId)) {
        this.selectedRoomId.set(rooms[0].id);
      }
    });

    effect(() => {
      const characters = this.characters();
      const currentId = this.selectedCharacterId();
      if (!characters.length) {
        return;
      }
      if (!currentId || !characters.some((character) => character.id === currentId)) {
        this.selectedCharacterId.set(characters[0].id);
      }
    });
  }

  setScope(scope: 'room' | 'character'): void {
    this.scope.set(scope);
  }

  selectRoom(roomId: string): void {
    this.selectedRoomId.set(roomId);
  }

  selectCharacter(characterId: string): void {
    this.selectedCharacterId.set(characterId);
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN');
  }

  trackById(_index: number, memory: MemoryRecord): string {
    return memory.id;
  }
}
