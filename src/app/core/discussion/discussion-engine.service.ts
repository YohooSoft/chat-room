import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { UiStore } from '../../store/ui.store';
import { LlmService } from '../llm/llm.service';
import { UserAffinityService } from '../haiku/user-affinity.service';
import { Role } from '../../shared/types/chat.types';

const MAX_SPEAKERS_PER_ROUND = 5;
const MAX_AI_ROUNDS = 5; // AI-to-AI rounds after the initial user reply

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore,
    private readonly uiStore: UiStore,
    private readonly affinityService: UserAffinityService
  ) {}

  /**
   * Unified sequential conversation engine.
   *
   * Round 0: Each character replies to the USER.
   *          Later characters SEE what earlier ones said.
   * Round 1~5: AI-to-AI free dialogue.
   *            Context accumulates so no one repeats.
   *
   * After 5 AI-to-AI rounds, shows a modal asking to continue.
   */
  async run(
    roomId: string,
    _round: number,
    speakers: string[],
    userContent?: string
  ): Promise<void> {
    const activeSpeakers = speakers.slice(0, MAX_SPEAKERS_PER_ROUND);
    if (!activeSpeakers.length) return;

    const otherNames: string[] = activeSpeakers
      .map((id) => this.characterStore.getCharacter(id)?.name)
      .filter((n): n is string => !!n);

    // ── Build initial context from recent room messages ──────────
    const roomMessages = this.chatStore.messagesForRoom(roomId);
    const charLookup = this.characterStore.byId();
    interface ContextEntry { role: Role; content: string; speakerName?: string }
    const context: ContextEntry[] = roomMessages
      .slice(-8)
      .map((m) => {
        const name = charLookup[m.senderId]?.name;
        const clean = m.content
          .replace(/\[.+?\][：:]\s*/g, '')
          .replace(/([一-鿿\w]+[：:]){1,3}\s*/g, '');
        return {
          role: m.role === 'user' ? ('user' as Role) : ('assistant' as Role),
          content: clean,
          speakerName: m.senderId === 'user' ? undefined : name
        };
      });

    // ── Round 0: Reply to USER sequentially ─────────────────────
    console.info(`[DiscussionEngine] Round 0 — 回复用户`);
    await this.runRound(activeSpeakers, otherNames, context, 0, userContent, roomId);

    // ── Rounds 1~5: AI-to-AI dialogue ───────────────────────────
    for (let round = 1; round <= MAX_AI_ROUNDS; round++) {
      console.info(`[DiscussionEngine] Round ${round}/${MAX_AI_ROUNDS} — AI 自由对话`);
      await this.runRound(activeSpeakers, otherNames, context, round, undefined, roomId);
    }

    // ── Pause & ask user ────────────────────────────────────────
    console.info(`[DiscussionEngine] ${MAX_AI_ROUNDS} 轮完成，弹窗询问`);
    this.uiStore.pauseDiscussion(roomId, speakers);
  }

  /**
   * Generate tone guidance based on user↔character affinity score.
   * Injected into system prompt so the model adapts its warmth.
   */
  private affinityGuidance(score: number, name: string): string {
    if (score >= 0.8) return `你与用户非常亲密（亲密度 ${Math.round(score * 100)}%），像老朋友一样——语气可以随意、温暖、有默契。`;
    if (score >= 0.5) return `你与用户比较熟悉（亲密度 ${Math.round(score * 100)}%），友好但保持适度的分寸。`;
    if (score >= 0.3) return `你与用户刚认识不久（亲密度 ${Math.round(score * 100)}%），礼貌、友善，保持适当距离。`;
    return `你与用户初次交流（亲密度 ${Math.round(score * 100)}%），像第一次见面一样自然问候。`;
  }

  private async runRound(
    speakers: string[],
    otherNames: string[],
    context: Array<{ role: Role; content: string; speakerName?: string }>,
    round: number,
    userContent: string | undefined,
    roomId: string
  ): Promise<void> {
    for (const speakerId of speakers) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) continue;

      const peers = otherNames.filter((n) => n !== character.name);

      // Build the right system prompt for this round
      let systemMsg: string;
      if (round === 0) {
        // Reply to user — like a group chat where people see each other's messages
        const affinityScore = this.affinityService.getAffinity(speakerId);
        const affinityHint = this.affinityGuidance(affinityScore, character.name);
        const positionIndex = speakers.indexOf(speakerId);
        if (positionIndex === 0) {
          systemMsg = `你是 ${character.name}。用户说：「${userContent || ''}」。上方的对话历史中"XX 说："是标注谁说了什么，不是让你模仿的格式。请直接输出你要说的话，不要加任何名字前缀。如果用户明显在对别人说话，你可以保持沉默。禁止：动作旁白、"名字："前缀。${affinityHint}${character.personality ? `你的性格：${character.personality}` : ''}`;
        } else {
          const prevName = speakers
            .slice(0, positionIndex)
            .map((id) => this.characterStore.getCharacter(id)?.name)
            .filter(Boolean)
            .join('、');
          systemMsg = `你是 ${character.name}。用户说：「${userContent || ''}」。${prevName} 已经回应了（见上文"XX 说："标注）。请直接输出你要说的话，不要加名字前缀。如果你觉得与自己相关请自然回应，否则可以沉默。禁止：动作旁白、"名字："前缀。${affinityHint}${character.personality ? `你的性格：${character.personality}` : ''}`;
        }
      } else {
        // AI-to-AI — natural group chat
        const guidance = round === 1
          ? '大家刚开始聊——放轻松，想到什么说什么。'
          : '已经聊了一会儿了——别重复老话题，可以深入细节、换角度、甚至歪楼。';
        systemMsg = `你是 ${character.name}。你正在跟 ${peers.join('、')} 聊天。像朋友之间那样自然——可以有语气词、小动作、玩笑、调侃，想到什么说什么。${guidance}${character.personality ? ` 你的性格：${character.personality}` : ''}`;
      }

      // All context messages → role:'user' so AI never confuses them as own speech.
      // Include speaker name as natural prefix for attribution.
      const speakerContext = context.map((m) => ({
        role: 'user' as Role,
        content: m.speakerName && m.speakerName !== character.name
          ? `${m.speakerName} 说：${m.content}`
          : m.content
      }));

      const messages: Array<{ role: Role; content: string }> = [
        { role: 'system', content: systemMsg },
        ...speakerContext
      ];

      const messageId = this.chatStore.beginStreamingMessage(roomId, character.id);
      let fullContent = '';

      try {
        const stream = this.llmService.chatStream(character.model.provider, {
          model: character.model.model,
          temperature: character.model.temperature,
          messages
        });

        for await (const chunk of stream) {
          fullContent += chunk;
          this.chatStore.appendStreamChunk(messageId, chunk);
        }

        this.chatStore.finalizeStreamedMessage(messageId);
      } catch {
        this.chatStore.finalizeStreamedMessage(messageId);
      }

      // Append to rolling context so the NEXT speaker sees this
      if (fullContent) {
        context.push({
          role: 'assistant' as Role,
          speakerName: character.name,
          content: fullContent
        });
      }
    }
  }
}
