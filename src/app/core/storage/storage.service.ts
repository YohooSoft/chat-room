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
    location: '',
    background: '',
    profile: {},
    preferences: {}
  },
  userAffinity: {}
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
  },
  userAffinity: { ...DEFAULT_STATE.userAffinity, ...(state.userAffinity ?? {}) }
});

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly stateSignal = signal<AppStorageState>(this.readFromStorage());
  readonly state = this.stateSignal.asReadonly();

  constructor() {
    // Cross-tab sync: listen for localStorage changes from other tabs
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY) {
          return;
        }
        if (event.newValue === null) {
          this.stateSignal.set(mergeState({}));
          return;
        }
        try {
          const parsed = JSON.parse(event.newValue) as Partial<AppStorageState>;
          this.stateSignal.set(mergeState(parsed));
        } catch {
          this.stateSignal.set(mergeState({}));
        }
      });
    }
  }

  read(): AppStorageState {
    return structuredClone(this.readFromStorage());
  }

  write(state: AppStorageState): void {
    this.stateSignal.set(structuredClone(state));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.stateSignal.set(mergeState({}));
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
