import { Injectable } from '@angular/core';

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

@Injectable({ providedIn: 'root' })
export class StorageService {
  read(): AppStorageState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_STATE);
    }

    try {
      return { ...DEFAULT_STATE, ...JSON.parse(raw) as Partial<AppStorageState> };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  write(state: AppStorageState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
