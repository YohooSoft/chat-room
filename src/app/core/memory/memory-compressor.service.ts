import { Injectable } from '@angular/core';

import { MemoryRecord, MemoryRecord as Memory } from '../../shared/types/chat.types';
import { createId } from '../../shared/utils/id.util';
import { MemoryService } from '../memory/memory.service';
import { StorageService } from '../storage/storage.service';

// ── Compression Constants ──────────────────────────────────────────
const COMPRESSION_TRIGGER_COUNT = 10; // Compress when room memories exceed this
const COMPRESSION_KEEP_RECENT = 5; // Keep most recent memories uncompressed
const SUMMARY_PREFIX = '[摘要] ';
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4; // Approximate: ~4 chars per token
const MAX_CONTEXT_TOKENS = 4000; // Soft token budget for context building

@Injectable({ providedIn: 'root' })
export class MemoryCompressorService {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly storageService: StorageService
  ) {}

  /**
   * Compress room memories: when a room exceeds COMPRESSION_TRIGGER_COUNT
   * memories, summarize the oldest ones into a single compressed record.
   *
   * Returns the number of memories compressed.
   */
  compressRoomMemories(roomId: string): number {
    const memories = [...this.memoryService.getRoomMemories(roomId)].sort(
      (a, b) => b.createdAt - a.createdAt
    );

    if (memories.length <= COMPRESSION_TRIGGER_COUNT) {
      return 0;
    }

    // Keep the most recent memories intact
    const recent = memories.slice(0, COMPRESSION_KEEP_RECENT);
    const toCompress = memories.slice(COMPRESSION_KEEP_RECENT);

    // Already compressed? Skip
    const uncompressed = toCompress.filter((m) => !m.content.startsWith(SUMMARY_PREFIX));
    if (!uncompressed.length) {
      return 0;
    }

    // Generate summary from uncompressed memories
    const summary = this.summarize(uncompressed);
    const state = this.storageService.read();
    const compressed: MemoryRecord = {
      id: createId(),
      scope: 'room',
      targetId: roomId,
      content: summary,
      importance: Math.max(...uncompressed.map((m) => m.importance)),
      createdAt: Date.now()
    };

    // Replace compressed memories with summary + keep recent
    const nextMemories = [...recent, compressed];

    // Persist
    state.memories.room[roomId] = nextMemories;
    this.storageService.write(state);

    console.info(
      `[MemoryCompressor] 房间 ${roomId}: ${uncompressed.length} 条记忆压缩为 1 条摘要`
    );
    return uncompressed.length;
  }

  /**
   * Estimate token count for a given text.
   * Uses a simple char-based heuristic (roughly 4 chars = 1 token for CJK+EN).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN);
  }

  /**
   * Build an optimized context window from messages, fitting within
   * the token budget. Prioritizes:
   * 1. System messages (always included)
   * 2. Most recent messages
   * 3. Older messages if budget allows
   */
  buildContextWindow(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number = MAX_CONTEXT_TOKENS
  ): Array<{ role: string; content: string }> {
    if (!messages.length) return [];

    const systemMessages = messages.filter((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    let tokenBudget = maxTokens;
    const result: Array<{ role: string; content: string }> = [];

    // System messages first
    for (const msg of systemMessages) {
      const tokens = this.estimateTokens(msg.content);
      if (tokens <= tokenBudget) {
        result.push({ ...msg });
        tokenBudget -= tokens;
      }
    }

    // Most recent non-system messages
    const reversed = [...otherMessages].reverse();
    for (const msg of reversed) {
      const tokens = this.estimateTokens(msg.content);
      if (tokens <= tokenBudget) {
        result.push({ ...msg });
        tokenBudget -= tokens;
      } else if (tokenBudget > 0) {
        // Truncate to fit remaining budget
        const truncatedChars = tokenBudget * TOKEN_ESTIMATE_CHARS_PER_TOKEN;
        result.push({
          role: msg.role,
          content: msg.content.slice(0, truncatedChars) + '...'
        });
        break;
      }
    }

    // Restore original order
    const ordered = result.filter((m) => m.role === 'system');
    const nonSystem = result.filter((m) => m.role !== 'system');
    const sortedNonSystem = [...nonSystem].reverse(); // restore chronological order

    return [...ordered, ...sortedNonSystem];
  }

  /**
   * Summarize a list of memory records into a single compressed text.
   */
  private summarize(memories: Memory[]): string {
    const topics = memories
      .map((m) => m.content.slice(0, 80))
      .slice(0, 20)
      .join('；');
    const dateRange = this.formatDateRange(
      memories[memories.length - 1]?.createdAt,
      memories[0]?.createdAt
    );
    return `${SUMMARY_PREFIX}${dateRange}，共 ${memories.length} 条记忆。要点：${topics}`;
  }

  private formatDateRange(start?: number, end?: number): string {
    if (!start) return '';
    const fmt = (ts: number) => new Date(ts).toLocaleDateString('zh-CN');
    if (!end || start === end) return fmt(start);
    return `${fmt(start)} ~ ${fmt(end)}`;
  }
}
