import { Injectable } from '@angular/core';

import { Action, AppStorageState, MemoryRecord } from '../../shared/types/chat.types';
import { createId } from '../../shared/utils/id.util';
import { StorageService } from '../storage/storage.service';

@Injectable({ providedIn: 'root' })
export class MemoryService {
  constructor(private readonly storageService: StorageService) {}

  write(action: Extract<Action, { type: 'write_memory' }>): void {
    const state = this.storageService.read();
    const memory: MemoryRecord = {
      id: createId(),
      scope: action.scope,
      targetId: action.targetId,
      content: action.content,
      importance: action.importance,
      createdAt: Date.now()
    };

    this.appendMemory(state, memory);
    this.storageService.write(state);
  }

  getRoomMemories(roomId: string): MemoryRecord[] {
    const state = this.storageService.read();
    return state.memories.room[roomId] ?? [];
  }

  getCharacterMemories(characterId: string): MemoryRecord[] {
    const state = this.storageService.read();
    return state.memories.character[characterId] ?? [];
  }

  private appendMemory(state: AppStorageState, memory: MemoryRecord): void {
    const key = memory.targetId ?? 'global';
    const group = state.memories[memory.scope];
    const existing = group[key] ?? [];
    group[key] = [...existing, memory];
  }
}
