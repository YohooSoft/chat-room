import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { StorageService } from '../../core/storage/storage.service';
import { AppStorageState } from '../../shared/types/chat.types';

interface CustomModel {
  provider: string;
  model: string;
}

interface ProviderApiConfig {
  apiKey: string;
  baseUrl: string;
}

interface UserPreferences extends Record<string, unknown> {
  defaultProvider?: string;
  defaultModel?: string;
  defaultTemperature?: number;
  customModels?: CustomModel[];
  providerApiKeys?: Record<string, ProviderApiConfig>;
}

const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  'openai-compatible': ''
};

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

  // Model management
  readonly customModels = signal<CustomModel[]>([]);
  readonly modelSearch = signal('');
  readonly newModelProvider = signal(DEFAULT_PROVIDER);
  readonly newModelName = signal('');

  // API keys
  readonly apiKeys = signal<Record<string, ProviderApiConfig>>({});
  readonly showApiKeys = signal(false);

  readonly filteredModels = computed(() => {
    const search = this.modelSearch().toLowerCase().trim();
    if (!search) {
      return this.customModels();
    }
    return this.customModels().filter(
      (m) =>
        m.model.toLowerCase().includes(search) ||
        m.provider.toLowerCase().includes(search)
    );
  });

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
      defaultTemperature: this.temperature(),
      customModels: this.customModels(),
      providerApiKeys: this.apiKeys()
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

  // API key management
  updateApiKey(provider: string, apiKey: string): void {
    this.apiKeys.update((keys) => ({
      ...keys,
      [provider]: { ...(keys[provider] ?? { apiKey: '', baseUrl: '' }), apiKey }
    }));
  }

  updateBaseUrl(provider: string, baseUrl: string): void {
    this.apiKeys.update((keys) => ({
      ...keys,
      [provider]: { ...(keys[provider] ?? { apiKey: '', baseUrl: '' }), baseUrl }
    }));
  }

  getApiKey(provider: string): string {
    return this.apiKeys()[provider]?.apiKey ?? '';
  }

  getBaseUrl(provider: string): string {
    return this.apiKeys()[provider]?.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider] ?? '';
  }

  getDefaultBaseUrl(provider: string): string {
    return DEFAULT_PROVIDER_BASE_URLS[provider] ?? '';
  }

  // Model management methods
  addModel(): void {
    const modelName = this.newModelName().trim();
    if (!modelName) {
      return;
    }
    const exists = this.customModels().some(
      (m) => m.provider === this.newModelProvider() && m.model === modelName
    );
    if (exists) {
      return;
    }
    this.customModels.update((models) => [
      ...models,
      { provider: this.newModelProvider(), model: modelName }
    ]);
    this.newModelName.set('');
  }

  removeModel(index: number): void {
    this.customModels.update((models) => {
      const next = [...models];
      next.splice(index, 1);
      return next;
    });
  }

  updateTemperature(value: string): void {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, numeric));
    this.temperature.set(clamped);
  }

  resetAllData(): void {
    this.storageService.clear();
    window.location.reload();
  }

  private load(): void {
    const state = this.storageService.read();
    const preferences = state.user.preferences as UserPreferences;
    this.name.set(state.user.name ?? '');
    this.provider.set(preferences.defaultProvider ?? DEFAULT_PROVIDER);
    this.model.set(preferences.defaultModel ?? DEFAULT_MODEL);
    this.temperature.set(
      typeof preferences.defaultTemperature === 'number'
        ? preferences.defaultTemperature
        : DEFAULT_TEMPERATURE
    );
    this.customModels.set(preferences.customModels ?? []);
    this.apiKeys.set(preferences.providerApiKeys ?? {});
  }
}
