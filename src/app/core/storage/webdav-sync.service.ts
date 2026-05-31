import { Injectable } from '@angular/core';

import { AppStorageState } from '../../shared/types/chat.types';
import { StorageService } from './storage.service';

// ── WebDAV Config ──────────────────────────────────────────────────
interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  remotePath: string;
}

const STORAGE_KEY = 'ai-drama-engine';
const DEFAULT_REMOTE_FILENAME = 'ai-drama-engine.json';
const SYNC_STATE_KEY = 'webdav-last-sync';

@Injectable({ providedIn: 'root' })
export class WebDavSyncService {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Export current state to a WebDAV server.
   *
   * @param config - WebDAV connection configuration
   * @returns success message or throws on error
   */
  async exportToWebDav(config: WebDavConfig): Promise<string> {
    const state = this.storageService.read();
    const content = JSON.stringify(state, null, 2);
    const remoteUrl = this.buildRemoteUrl(config);

    const response = await fetch(remoteUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: content,
      ...this.authHeaders(config)
    });

    if (!response.ok) {
      throw new Error(`WebDAV 导出失败: HTTP ${response.status} ${response.statusText}`);
    }

    const timestamp = new Date().toISOString();
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({ lastExport: timestamp, url: config.url }));
    console.info(`[WebDAV] 已导出到 ${remoteUrl}`);
    return timestamp;
  }

  /**
   * Import state from a WebDAV server, merging with local state.
   *
   * @param config - WebDAV connection configuration
   * @returns the merged state or throws on error
   */
  async importFromWebDav(config: WebDavConfig): Promise<AppStorageState> {
    const remoteUrl = this.buildRemoteUrl(config);

    const response = await fetch(remoteUrl, {
      method: 'GET',
      ...this.authHeaders(config)
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('远程文件不存在，请先导出一次。');
      }
      throw new Error(`WebDAV 导入失败: HTTP ${response.status} ${response.statusText}`);
    }

    const raw = await response.text();
    let remoteState: Partial<AppStorageState>;
    try {
      remoteState = JSON.parse(raw);
    } catch {
      throw new Error('远程文件格式错误，无法解析 JSON。');
    }

    const localState = this.storageService.read();
    const merged = this.mergeStates(localState, remoteState);
    this.storageService.write(merged);

    const timestamp = new Date().toISOString();
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({ lastImport: timestamp, url: config.url }));
    console.info(`[WebDAV] 已从 ${remoteUrl} 导入并合并数据`);
    return merged;
  }

  /**
   * Test WebDAV connection by attempting a PROPFIND on the parent directory.
   */
  async testConnection(config: WebDavConfig): Promise<boolean> {
    const parentUrl = this.buildRemoteUrl(config).replace(/\/[^/]+$/, '') || config.url;

    try {
      const response = await fetch(parentUrl, {
        method: 'PROPFIND',
        headers: { Depth: '0' },
        ...this.authHeaders(config)
      });
      return response.ok || response.status === 207;
    } catch {
      return false;
    }
  }

  /**
   * Get the last sync timestamp info.
   */
  getLastSyncInfo(): { lastExport?: string; lastImport?: string; url?: string } | null {
    const raw = localStorage.getItem(SYNC_STATE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Build the full remote URL for the data file.
   */
  private buildRemoteUrl(config: WebDavConfig): string {
    const base = config.url.replace(/\/+$/, '');
    const path = (config.remotePath || DEFAULT_REMOTE_FILENAME).replace(/^\/+/, '');
    return `${base}/${path}`;
  }

  /**
   * Build Basic Auth headers from config.
   */
  private authHeaders(config: WebDavConfig): { headers?: Record<string, string> } {
    if (!config.username) return {};
    const encoded = btoa(`${config.username}:${config.password}`);
    return {
      headers: {
        Authorization: `Basic ${encoded}`
      }
    };
  }

  /**
   * Merge remote state into local state.
   * Remote data takes priority for structural fields;
   * arrays (messages, memories) are merged by ID (union).
   */
  private mergeStates(
    local: AppStorageState,
    remote: Partial<AppStorageState>
  ): AppStorageState {
    const merged: AppStorageState = {
      rooms: { ...local.rooms, ...(remote.rooms ?? {}) },
      characters: { ...local.characters, ...(remote.characters ?? {}) },
      messages: this.mergeRecordArrays(local.messages, remote.messages ?? {}),
      memories: {
        room: this.mergeRecordArrays(local.memories.room, remote.memories?.room ?? {}),
        character: this.mergeRecordArrays(
          local.memories.character,
          remote.memories?.character ?? {}
        )
      },
      user: {
        ...local.user,
        ...remote.user,
        profile: { ...local.user.profile, ...(remote.user?.profile ?? {}) },
        preferences: { ...local.user.preferences, ...(remote.user?.preferences ?? {}) }
      },
      userAffinity: { ...local.userAffinity, ...(remote.userAffinity ?? {}) }
    };
    return merged;
  }

  private mergeRecordArrays<T>(
    local: Record<string, T[]>,
    remote: Record<string, T[]>
  ): Record<string, T[]> {
    const result = { ...local };
    for (const [key, remoteItems] of Object.entries(remote)) {
      const localItems = result[key] ?? [];
      const localIds = new Set(localItems.map((item) => (item as any).id));
      const newItems = remoteItems.filter(
        (item) => !localIds.has((item as any).id)
      );
      result[key] = [...localItems, ...newItems];
    }
    return result;
  }
}
