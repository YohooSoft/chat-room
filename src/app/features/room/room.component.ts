import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MemoryService } from '../../core/memory/memory.service';
import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { RoomStore } from '../../store/room.store';

interface NewCharacterForm {
  name: string;
  personality: string;
  background: string;
}

const DEFAULT_NEW_FORM: NewCharacterForm = {
  name: '',
  personality: '',
  background: ''
};

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
  readonly newRoomName = signal('');
  readonly newRoomCharacterIds = signal<string[]>([]);
  readonly showNewCharacterForm = signal(false);
  readonly newCharacter = signal<NewCharacterForm>({ ...DEFAULT_NEW_FORM });

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
    if (!summaries.length) return undefined;
    const activeId = this.roomStore.activeRoomId();
    return summaries.find((s) => s.id === activeId) ?? summaries[0];
  });

  /**
   * Characters currently assigned to the active room, with full details.
   */
  readonly activeRoomCharacters = computed(() => {
    const room = this.activeRoom();
    if (!room) return [];
    const characterMap = this.characterStore.byId();
    return room.characterIds
      .map((id) => characterMap[id])
      .filter(Boolean)
      .map((c) => ({
        ...c,
        modelLabel: `${c.model.provider}/${c.model.model}`
      }));
  });

  /**
   * Characters NOT yet assigned to the active room.
   */
  readonly availableCharacters = computed(() => {
    const room = this.activeRoom();
    const assignedIds = new Set(room?.characterIds ?? []);
    return this.characterStore.characters().filter(
      (c) => !assignedIds.has(c.id) && !c.isSystem
    );
  });

  constructor() {
    effect(() => {
      const active = this.roomStore.activeRoom();
      if (!active) return;
      this.editName.set(active.name);
    });
  }

  // ── Room actions ──────────────────────────────────────────────────

  setActiveRoom(roomId: string): void {
    this.roomStore.setActiveRoom(roomId);
  }

  saveRoomName(): void {
    const roomId = this.roomStore.activeRoomId();
    const name = this.editName().trim();
    if (!roomId || !name) return;
    this.roomStore.updateRoom(roomId, { name });
  }

  deleteRoom(roomId: string): void {
    this.roomStore.deleteRoom(roomId);
  }

  createRoom(): void {
    const name = this.newRoomName().trim();
    if (!name) return;
    this.roomStore.createRoom(name, this.newRoomCharacterIds());
    this.newRoomName.set('');
    this.newRoomCharacterIds.set([]);
  }

  toggleNewCharacter(characterId: string): void {
    this.newRoomCharacterIds.update((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId]
    );
  }

  // ── Dynamic character management ─────────────────────────────────

  /** Immediately add a character to the active room (auto-save). */
  addCharacterToRoom(characterId: string): void {
    const room = this.activeRoom();
    if (!room || room.characterIds.includes(characterId)) return;
    const nextIds = [...room.characterIds, characterId];
    this.roomStore.updateRoom(room.id, { characterIds: nextIds });
  }

  /** Immediately remove a character from the active room (auto-save). */
  removeCharacterFromRoom(characterId: string): void {
    const room = this.activeRoom();
    if (!room) return;
    const nextIds = room.characterIds.filter((id) => id !== characterId);
    this.roomStore.updateRoom(room.id, { characterIds: nextIds });
  }

  // ── Inline character creation ─────────────────────────────────────

  toggleNewCharacterForm(): void {
    this.showNewCharacterForm.update((v) => !v);
    if (this.showNewCharacterForm()) {
      this.newCharacter.set({ ...DEFAULT_NEW_FORM });
    }
  }

  createAndAddCharacter(): void {
    const form = this.newCharacter();
    const name = form.name.trim();
    if (!name) return;

    const character = this.characterStore.createCharacter({
      name,
      personality: form.personality.trim() || '待补充',
      background: form.background.trim()
    });

    // Auto-add to current room
    this.addCharacterToRoom(character.id);
    this.showNewCharacterForm.set(false);
    this.newCharacter.set({ ...DEFAULT_NEW_FORM });
  }

  updateNewCharacter(update: Partial<NewCharacterForm>): void {
    this.newCharacter.update((c) => ({ ...c, ...update }));
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }
}
