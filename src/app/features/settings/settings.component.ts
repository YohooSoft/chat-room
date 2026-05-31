import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { StorageService } from '../../core/storage/storage.service';
import { AppStorageState } from '../../shared/types/chat.types';

interface UserPreferences extends Record<string, unknown> {
  defaultProvider?: string;
  defaultModel?: string;
  defaultTemperature?: number;
}

const SAVE_MESSAGE_PREFIX = '已保存';
const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.7;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  private readonly storageService = inject(StorageService);

  readonly providers = ['openai', 'claude', 'gemini', 'openai-compatible'];

  readonly name = signal('');
  readonly provider = signal(DEFAULT_PROVIDER);
  readonly model = signal(DEFAULT_MODEL);
  readonly temperature = signal(DEFAULT_TEMPERATURE);
  readonly savedMessage = signal('');

  readonly storageSummary = computed(() => {
    const state = this.storageService.state();
    const roomMemories = Object.values(state.memories.room).reduce(
      (total, list) => total + list.length,
      0
    );
    const characterMemories = Object.values(state.memories.character).reduce(
      (total, list) => total + list.length,
      0
    );
    const messageCount = Object.values(state.messages).reduce(
      (total, list) => total + list.length,
      0
    );
    return {
      rooms: Object.keys(state.rooms).length,
      characters: Object.keys(state.characters).length,
      messages: messageCount,
      roomMemories,
      characterMemories
    };
  });

  constructor() {
    this.load();
  }

  save(): void {
    const state = this.storageService.read();
    const preferences: UserPreferences = {
      ...(state.user.preferences as UserPreferences),
      defaultProvider: this.provider(),
      defaultModel: this.model(),
      defaultTemperature: this.temperature()
    };
    const nextState: AppStorageState = {
      ...state,
      user: {
        ...state.user,
        name: this.name(),
        preferences
      }
    };
    this.storageService.write(nextState);
    this.savedMessage.set(`${SAVE_MESSAGE_PREFIX} ${new Date().toLocaleTimeString('zh-CN')}`);
  }

  updateTemperature(value: string): void {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, numeric));
    this.temperature.set(clamped);
  }

  private load(): void {
    const state = this.storageService.read();
    this.storageState.set(state);
    const preferences = state.user.preferences as UserPreferences;
    this.name.set(state.user.name ?? '');
    this.provider.set(preferences.defaultProvider ?? DEFAULT_PROVIDER);
    this.model.set(preferences.defaultModel ?? DEFAULT_MODEL);
    this.temperature.set(
      typeof preferences.defaultTemperature === 'number'
        ? preferences.defaultTemperature
        : DEFAULT_TEMPERATURE
    );
  }
}
