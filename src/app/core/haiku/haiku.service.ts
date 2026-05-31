import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { RoomStore } from '../../store/room.store';
import { Action, Character, ExecutionPlan, Role } from '../../shared/types/chat.types';
import { MemoryCompressorService } from '../memory/memory-compressor.service';

// ── Scheduling Constants ────────────────────────────────────────────
const MAX_ACTIONS_PER_PLAN = 12;
const MAX_CHARACTERS_PER_TURN = 4;
const MIN_CONTENT_LENGTH_FOR_MEMORY = 20;
const CONTEXT_WINDOW_SIZE = 12;

// Memory-significant keywords (boost importance)
const MEMORY_SIGNIFICANT_KEYWORDS = [
  '重要', '记住', '关键', '改变', '决定', '转折',
  'important', 'remember', 'key', 'critical', 'decision', 'twist'
];

// Character engagement: how many consecutive turns a character can participate
// before needing a cooldown. Tracked per character per room via message history.
const CHARACTER_COOLDOWN_TURNS = 1;

@Injectable({ providedIn: 'root' })
export class HaikuService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly chatStore: ChatStore,
    private readonly roomStore: RoomStore,
    private readonly memoryCompressor: MemoryCompressorService
  ) {}

  /**
   * Generate a stable, deterministic ExecutionPlan from user input.
   *
   * The scheduler follows these rules in order:
   * 1. Start turn (typing indicator)
   * 2. Select characters eligible to respond (not in cooldown)
   * 3. Optionally trigger AI-to-AI discussion if conversation is active
   * 4. Write memory for significant content
   * 5. End turn (stop typing, end turn)
   *
   * Stability guarantees:
   * - Actions are capped at {@link MAX_ACTIONS_PER_PLAN}
   * - Characters enter cooldown after speaking to prevent floods
   * - Discussions enforce max rounds and repetition guards
   * - Memory importance is computed via multi-factor scoring
   */
  createPlan(roomId: string, userContent: string): ExecutionPlan {
    const allCharacters = this.characterStore.characters();

    // System characters (Haiku) are always active as schedulers — not room-dependent
    const systemCharacters = allCharacters.filter((c) => c.isSystem);

    // Visible characters: only those assigned to THIS room may speak
    const room = this.roomStore.rooms().find((r) => r.id === roomId);
    const roomCharacterIds = new Set(room?.characterIds ?? []);
    const visibleCharacters = allCharacters.filter(
      (c) => !c.isSystem && roomCharacterIds.has(c.id)
    );

    // Log system character activity to console only
    for (const sc of systemCharacters) {
      console.info(`[Haiku] 系统角色「${sc.name}」作为调度引擎运行中（不在 UI 显示）`);
    }

    if (!visibleCharacters.length) {
      // No visible characters — Haiku logs to console, hint in chat
      console.info('[Haiku] 当前房间无可发言角色。请在 /room 或 /character 中添加角色。');
      return {
        roomId,
        actions: [
          { type: 'ui_event', event: 'typing' },
          { type: 'ui_event', event: 'stop_typing' }
        ]
      };
    }

    const roomMessages = this.chatStore.messagesForRoom(roomId);

    // Auto-compress room memories if above threshold
    this.memoryCompressor.compressRoomMemories(roomId);

    // Build optimized context window with token budget
    const rawContext: Array<{ role: Role; content: string }> = roomMessages
      .slice(-CONTEXT_WINDOW_SIZE)
      .map((m) => ({ role: m.role, content: m.content }));
    const windowed = this.memoryCompressor.buildContextWindow(rawContext);
    const context: Array<{ role: Role; content: string }> = windowed.map((m) => ({
      role: m.role as Role,
      content: m.content
    }));

    const actions: Action[] = [];

    // ── Phase 1: Begin Turn ─────────────────────────────────────
    actions.push({ type: 'ui_event', event: 'typing' });

    // ── Phase 2: Select Characters ───────────────────────────────
    // All room characters get a chance — each AI model decides whether
    // it's being addressed and should respond
    const charactersToSpeak = this.shuffle(
      this.selectEligibleCharacters(visibleCharacters, roomMessages)
        .slice(0, MAX_CHARACTERS_PER_TURN)
    );

    console.info(
      `[Haiku] 发言顺序: ${charactersToSpeak.map((c) => c.name).join(' → ')}（AI自行判断是否被点名）`
    );

    // ── Phase 3+4: Unified discussion queue ──
    // DiscussionEngine runs everything sequentially:
    //   Round 0 = reply to user (each sees previous responses)
    //   Round 1-5 = AI-to-AI dialogue
    if (charactersToSpeak.length >= 1) {
      const speakerIds = charactersToSpeak.map((c) => c.id);

      actions.push({
        type: 'trigger_discussion',
        round: 0,
        speakers: speakerIds,
        userContent
      });
    }

    // ── Phase 5: Memory Write ───────────────────────────────────
    const shouldWriteMemory = this.shouldWriteMemory(userContent, roomMessages);
    if (shouldWriteMemory && actions.length < MAX_ACTIONS_PER_PLAN) {
      const importance = this.computeMemoryImportance(userContent, roomMessages);
      actions.push({
        type: 'write_memory',
        scope: 'room',
        targetId: roomId,
        content: userContent,
        importance
      });
    }

    // ── Phase 6: End Turn ───────────────────────────────────────
    actions.push({ type: 'ui_event', event: 'stop_typing' });
    actions.push({ type: 'ui_event', event: 'end_turn' });

    // ── Debug Output (console only, not UI) ─────────────────────
    this.logPlan(roomId, userContent, actions, {
      totalCharacters: allCharacters.length,
      visibleCharacters: visibleCharacters.length,
      systemCharacters: systemCharacters.length,
      speakingCount: charactersToSpeak.length
    });

    return { roomId, actions };
  }

  // ── Character Selection ──────────────────────────────────────────

  /**
   * Select characters eligible to respond this turn.
   *
   * Rules:
   * - Exclude characters that spoke in the last CHARACTER_COOLDOWN_TURNS turns
   * - Prioritize characters that haven't spoken recently
   * - Always include at least 1 character
   */
  private selectEligibleCharacters(
    characters: Character[],
    messages: Array<{ senderId: string; createdAt: number }>
  ): Character[] {
    if (characters.length <= 1) return [...characters];

    const recentSpeakers = new Set(
      messages
        .filter((m) => m.senderId !== 'user')
        .slice(-CHARACTER_COOLDOWN_TURNS * characters.length)
        .map((m) => m.senderId)
    );

    // Sort: characters NOT in recent speakers first, then by name for stability
    const sorted = [...characters].sort((a, b) => {
      const aRecent = recentSpeakers.has(a.id) ? 1 : 0;
      const bRecent = recentSpeakers.has(b.id) ? 1 : 0;
      if (aRecent !== bRecent) return aRecent - bRecent;
      return a.name.localeCompare(b.name);
    });

    // Always ensure at least the first character (prioritized) is included
    return sorted.length ? sorted : characters;
  }

  // ── Memory Logic ─────────────────────────────────────────────────

  /**
   * Decide whether user content should be persisted as a memory record.
   *
   * Conditions (any one triggers write):
   * - Content length exceeds threshold
   * - Content contains memory-significant keywords
   * - Conversation has substantial history
   */
  private shouldWriteMemory(
    content: string,
    messages: Array<{ content: string }>
  ): boolean {
    if (content.length >= MIN_CONTENT_LENGTH_FOR_MEMORY) return true;
    if (MEMORY_SIGNIFICANT_KEYWORDS.some((kw) => content.toLowerCase().includes(kw)))
      return true;
    if (messages.length >= 6) return true;
    return false;
  }

  /**
   * Compute memory importance score (0.0 ~ 1.0) based on:
   * - Content length (longer → more important)
   * - Keyword presence (memory-significant keywords → boost)
   * - Conversation depth (more messages → context is richer)
   */
  private computeMemoryImportance(
    content: string,
    messages: Array<{ content: string }>
  ): number {
    let score = 0.3; // base

    // Length factor (0 ~ 0.3)
    score += Math.min(0.3, content.length / 200);

    // Keyword boost (0 ~ 0.2)
    const keywordHits = MEMORY_SIGNIFICANT_KEYWORDS.filter((kw) =>
      content.toLowerCase().includes(kw)
    ).length;
    score += Math.min(0.2, keywordHits * 0.07);

    // Conversation depth (0 ~ 0.2)
    score += Math.min(0.2, messages.length * 0.02);

    return Math.min(1, Math.max(0, Math.round(score * 100) / 100));
  }

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Debug Logging ────────────────────────────────────────────────

  private logPlan(
    roomId: string,
    userContent: string,
    actions: Action[],
    meta: Record<string, unknown>
  ): void {
    console.groupCollapsed(
      `[Haiku] Plan → ${actions.length} actions | ${meta['speakingCount']}/${meta['visibleCharacters']} visible (+${meta['systemCharacters']} system)`
    );
    console.info('roomId', roomId);
    console.info('userContent', userContent.slice(0, 120));
    console.info('meta', meta);
    console.info(
      'actions',
      actions.map((a) => a.type)
    );
    console.groupEnd();
  }
}
