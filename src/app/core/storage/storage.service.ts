import { Injectable, signal } from '@angular/core';

import { AppStorageState } from '../../shared/types/chat.types';

const STORAGE_KEY = 'ai-drama-engine';

const DEFAULT_STATE: AppStorageState = {
  rooms: {},
  characters: {},
  messages: {},
  memories: {
    room: {},
    character: {}
  },
  user: {
    name: '',
    profile: {},
    preferences: {}
  }
};

const mergeState = (state: Partial<AppStorageState>): AppStorageState => ({
  ...DEFAULT_STATE,
  ...state,
  rooms: { ...DEFAULT_STATE.rooms, ...(state.rooms ?? {}) },
  characters: { ...DEFAULT_STATE.characters, ...(state.characters ?? {}) },
  messages: { ...DEFAULT_STATE.messages, ...(state.messages ?? {}) },
  memories: {
    room: { ...DEFAULT_STATE.memories.room, ...(state.memories?.room ?? {}) },
    character: { ...DEFAULT_STATE.memories.character, ...(state.memories?.character ?? {}) }
  },
  user: {
    ...DEFAULT_STATE.user,
    ...state.user,
    profile: { ...DEFAULT_STATE.user.profile, ...(state.user?.profile ?? {}) },
    preferences: { ...DEFAULT_STATE.user.preferences, ...(state.user?.preferences ?? {}) }
  }
});

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly stateSignal = signal<AppStorageState>(this.readFromStorage());
  readonly state = this.stateSignal.asReadonly();

  read(): AppStorageState {
    const state = this.readFromStorage();
    this.stateSignal.set(state);
    return structuredClone(state);
  }

  write(state: AppStorageState): void {
    this.stateSignal.set(structuredClone(state));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  private readFromStorage(): AppStorageState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return mergeState({});
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AppStorageState>;
      return mergeState(parsed);
    } catch {
      return mergeState({});
    }
  }
}
