import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { RoomStore } from '../../store/room.store';
import { Character, Action, ExecutionPlan, Role } from '../../shared/types/chat.types';
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

    // ── Phase 2: Select Characters (visible only, no cooldown) ──
    // All room characters speak — each AI model judges its own relevance
    const charactersToSpeak = this.selectEligibleCharacters(visibleCharacters, roomMessages)
      .slice(0, MAX_CHARACTERS_PER_TURN);

    console.info(
      `[Haiku] 发言角色: ${charactersToSpeak.map((c) => c.name).join(', ') || '(无)'} — 由AI自行判断相关性`
    );

    // ── Phase 3: Decide Discussion (2+ characters → AI dialogue) ─
    const shouldTriggerDiscussion = charactersToSpeak.length >= 2;

    // ── Phase 4: Model Calls ────────────────────────────────────
    // ── Phase 4: Round 1 — each character replies to the USER ──
    for (const character of charactersToSpeak) {
      if (actions.length >= MAX_ACTIONS_PER_PLAN) break;
      actions.push(this.buildModelCall(character, context, userContent));
    }

    // ── Phase 4b: AI-to-AI discussion (after user replies) ──
    if (shouldTriggerDiscussion) {
      const speakerIds = charactersToSpeak.map((c) => c.id);

      console.info(
        `[Haiku] 触发 AI 对话：${charactersToSpeak.map((c) => c.name).join(' → ')}（5轮自动循环）`
      );

      actions.push({
        type: 'trigger_discussion',
        round: 1,
        speakers: speakerIds
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
      speakingCount: charactersToSpeak.length,
      discussionTriggered: shouldTriggerDiscussion
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

  // ── Model Call Builder ───────────────────────────────────────────

  private buildModelCall(
    character: Character,
    context: Array<{ role: Role; content: string }>,
    userContent: string
  ): Extract<Action, { type: 'call_model' }> {
    const messages: Array<{ role: Role; content: string }> = [];
    const systemPrompt = this.buildSystemPrompt(character);

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push(...context);
    messages.push({ role: 'user', content: userContent });

    return {
      type: 'call_model',
      characterId: character.id,
      provider: character.model.provider,
      model: character.model.model,
      temperature: character.model.temperature,
      messages
    };
  }

  // ── System Prompt Builder ────────────────────────────────────────

  /**
   * Build a stable system prompt for a character.
   *
   * Advanced mode: uses the custom systemPrompt directly.
   * Auto mode: constructs from personality + background with a consistent
   * template that ensures role-consistent, natural responses.
   */
  buildSystemPrompt(character: Character): string {
    if (character.promptMode === 'advanced' && character.systemPrompt) {
      return character.systemPrompt;
    }

    const parts: string[] = [];

    // Core identity
    parts.push(`你是「${character.name}」。`);

    // Personality (required)
    if (character.personality) {
      parts.push(`性格特点：${character.personality}。`);
    }

    // Background (optional but adds depth)
    if (character.background) {
      parts.push(`背景：${character.background}。`);
    }

    // Behavioral guidelines — these are critical for stability
    parts.push(
      '请严格以这个角色的身份和语气来回应。',
      '保持角色一致性，不要跳出角色设定。',
      '回答要简洁有力，避免冗长含糊的表述。',
      '不要在回复中使用 thinking、think 标签包裹你的思考过程，直接给出最终回复即可。',
      '如果你不确定如何回应，基于角色的性格特点给出最合理的反应。',
      '不要重复其他角色已经说过的内容，提出新的视角或补充。'
    );

    return parts.join(' ');
  }

  // ── Debug Logging ────────────────────────────────────────────────

  private logPlan(
    roomId: string,
    userContent: string,
    actions: Action[],
    meta: Record<string, unknown>
  ): void {
    console.groupCollapsed(
      `[Haiku] Plan → ${actions.length} actions | ${meta['speakingCount']}/${meta['visibleCharacters']} visible (+${meta['systemCharacters']} system) | discussion: ${meta['discussionTriggered']}`
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
