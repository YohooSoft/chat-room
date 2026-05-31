import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { StorageService } from '../../core/storage/storage.service';
import { AppStorageState } from '../../shared/types/chat.types';

interface UserPreferences extends Record<string, unknown> {
  defaultProvider?: string;
  defaultModel?: string;
  defaultTemperature?: number;
}

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
  readonly provider = signal('openai');
  readonly model = signal('gpt-4o-mini');
  readonly temperature = signal(0.7);
  readonly savedMessage = signal('');

  private readonly storageState = signal<AppStorageState>(this.storageService.read());

  readonly storageSummary = computed(() => {
    const state = this.storageState();
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
    this.storageState.set(nextState);
    this.savedMessage.set(`已保存 ${new Date().toLocaleTimeString('zh-CN')}`);
  }

  updateTemperature(value: string): void {
    const numeric = Number(value);
    this.temperature.set(Number.isNaN(numeric) ? this.temperature() : numeric);
  }

  private load(): void {
    const state = this.storageService.read();
    this.storageState.set(state);
    const preferences = state.user.preferences as UserPreferences;
    this.name.set(state.user.name ?? '');
    this.provider.set(preferences.defaultProvider ?? 'openai');
    this.model.set(preferences.defaultModel ?? 'gpt-4o-mini');
    this.temperature.set(
      typeof preferences.defaultTemperature === 'number' ? preferences.defaultTemperature : 0.7
    );
  }
}
