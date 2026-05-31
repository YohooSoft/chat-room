import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { StorageService } from '../../core/storage/storage.service';
import { WebDavSyncService } from '../../core/storage/webdav-sync.service';
import { AppStorageState } from '../../shared/types/chat.types';

interface CustomModel {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  isGenAI?: boolean;
}

interface UserPreferences extends Record<string, unknown> {
  defaultProvider?: string;
  defaultModel?: string;
  defaultTemperature?: number;
  customModels?: CustomModel[];
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
  private readonly webdavSync = inject(WebDavSyncService);

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
  readonly newModelApiKey = signal('');
  readonly newModelBaseUrl = signal('');
  readonly newModelIsGenAI = signal(false);

  // WebDAV sync
  readonly webdavUrl = signal('');
  readonly webdavUsername = signal('');
  readonly webdavPassword = signal('');
  readonly webdavPath = signal('');
  readonly webdavStatus = signal('');
  readonly webdavError = signal('');
  readonly webdavConnecting = signal(false);
  readonly lastSyncInfo = signal(this.webdavSync.getLastSyncInfo());

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
      customModels: this.customModels()
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

  // Model management methods (auto-save on every change)
  addModel(): void {
    const modelName = this.newModelName().trim();
    if (!modelName) {
      return;
    }
    const provider = this.newModelProvider();
    const exists = this.customModels().some(
      (m) => m.provider === provider && m.model === modelName
    );
    if (exists) {
      return;
    }
    const apiKey = this.newModelApiKey().trim();
    const baseUrl = this.newModelBaseUrl().trim();
    const isGenAI = this.newModelIsGenAI();

    this.customModels.update((models) => [
      ...models,
      {
        provider,
        model: modelName,
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(isGenAI ? { isGenAI: true } : {})
      }
    ]);
    this.newModelName.set('');
    this.newModelApiKey.set('');
    this.newModelBaseUrl.set('');
    this.newModelIsGenAI.set(false);
    this.persistModels(); // auto-save immediately
  }

  removeModel(provider: string, modelName: string): void {
    this.customModels.update((models) =>
      models.filter((m) => !(m.provider === provider && m.model === modelName))
    );
    this.persistModels(); // auto-save immediately
  }

  /**
   * Persist only the customModels to localStorage without touching
   * other form fields (user name, default provider, etc.).
   */
  private persistModels(): void {
    const state = this.storageService.read();
    const nextState: AppStorageState = {
      ...state,
      user: {
        ...state.user,
        preferences: {
          ...(state.user.preferences as Record<string, unknown>),
          customModels: this.customModels()
        }
      }
    };
    this.storageService.write(nextState);
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

  // ── WebDAV sync ────────────────────────────────────────────────

  async testWebdavConnection(): Promise<void> {
    this.webdavConnecting.set(true);
    this.webdavError.set('');
    this.webdavStatus.set('正在测试连接...');

    const ok = await this.webdavSync.testConnection({
      url: this.webdavUrl().trim(),
      username: this.webdavUsername(),
      password: this.webdavPassword(),
      remotePath: this.webdavPath()
    });

    this.webdavConnecting.set(false);
    if (ok) {
      this.webdavStatus.set('✓ 连接成功');
      this.webdavError.set('');
    } else {
      this.webdavError.set('连接失败，请检查 URL 和凭据。');
      this.webdavStatus.set('');
    }
  }

  async exportToWebdav(): Promise<void> {
    const url = this.webdavUrl().trim();
    if (!url) {
      this.webdavError.set('请输入 WebDAV 地址。');
      return;
    }

    this.webdavConnecting.set(true);
    this.webdavError.set('');
    this.webdavStatus.set('正在导出...');

    try {
      const timestamp = await this.webdavSync.exportToWebDav({
        url,
        username: this.webdavUsername(),
        password: this.webdavPassword(),
        remotePath: this.webdavPath()
      });
      this.webdavStatus.set(`✓ 已导出 ${new Date(timestamp).toLocaleTimeString('zh-CN')}`);
      this.webdavError.set('');
    } catch (err) {
      this.webdavError.set(err instanceof Error ? err.message : '导出失败');
      this.webdavStatus.set('');
    } finally {
      this.webdavConnecting.set(false);
    }
  }

  async importFromWebdav(): Promise<void> {
    const url = this.webdavUrl().trim();
    if (!url) {
      this.webdavError.set('请输入 WebDAV 地址。');
      return;
    }

    this.webdavConnecting.set(true);
    this.webdavError.set('');
    this.webdavStatus.set('正在导入...');

    try {
      await this.webdavSync.importFromWebDav({
        url,
        username: this.webdavUsername(),
        password: this.webdavPassword(),
        remotePath: this.webdavPath()
      });
      this.webdavStatus.set('✓ 已导入并合并数据，页面即将刷新...');
      this.webdavError.set('');
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      this.webdavError.set(err instanceof Error ? err.message : '导入失败');
      this.webdavStatus.set('');
    } finally {
      this.webdavConnecting.set(false);
    }
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
  }
}
