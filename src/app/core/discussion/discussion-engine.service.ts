import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { UiStore } from '../../store/ui.store';
import { LlmService } from '../llm/llm.service';
import { UserAffinityService } from '../haiku/user-affinity.service';
import { Role } from '../../shared/types/chat.types';

const MAX_SPEAKERS_PER_ROUND = 5;
const MAX_AI_ROUNDS = 5;

function isTrivial(content: string): boolean {
  return content.replace(/[。.！!？?\s]+/g, '').length < 2;
}

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore,
    private readonly uiStore: UiStore,
    private readonly affinityService: UserAffinityService
  ) {}

  async run(
    roomId: string,
    _round: number,
    speakers: string[],
    userContent?: string
  ): Promise<void> {
    const activeSpeakers = speakers.slice(0, MAX_SPEAKERS_PER_ROUND);
    if (!activeSpeakers.length) return;

    const roomMessages = this.chatStore.messagesForRoom(roomId);
    const charLookup = this.characterStore.byId();
    const otherNames = activeSpeakers
      .map((id) => this.characterStore.getCharacter(id)?.name)
      .filter((n): n is string => !!n);

    // Shared context: each speaker sees all previous speakers' output
    const context: Array<{ role: Role; content: string; speakerName?: string }> = roomMessages
      .slice(-8)
      .map((m) => ({
        role: m.role === 'user' ? ('user' as Role) : ('assistant' as Role),
        content: m.content.replace(/\[.+?\][：:]\s*/g, '').replace(/([一-鿿\w]+[：:]){1,3}\s*/g, ''),
        speakerName: m.senderId === 'user' ? undefined : charLookup[m.senderId]?.name
      }));

    // ── Round 0: Sequential — each character decides if they're addressed ──
    console.info('[DiscussionEngine] Round 0 — 顺序回复用户');
    await this.runSequentialRound(activeSpeakers, otherNames, context, 0, userContent, roomId);

    // ── Filter out silent characters for subsequent AI rounds ─────
    const responsiveSpeakers = activeSpeakers.filter((id) => {
      const last = [...context].reverse().find((e) => e.speakerName === charLookup[id]?.name);
      return last && !isTrivial(last.content);
    });

    if (responsiveSpeakers.length >= 2) {
      for (let round = 1; round <= MAX_AI_ROUNDS; round++) {
        console.info(`[DiscussionEngine] Round ${round}/${MAX_AI_ROUNDS} — AI 自由对话`);
        await this.runSequentialRound(responsiveSpeakers, otherNames, context, round, undefined, roomId);
      }
      console.info('[DiscussionEngine] 完成，弹窗询问');
      this.uiStore.pauseDiscussion(roomId, speakers);
    }
  }

  private async runSequentialRound(
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
      const positionIndex = speakers.indexOf(speakerId);

      // Build system prompt
      let systemMsg: string;
      if (round === 0) {
        if (positionIndex === 0) {
          systemMsg = `你是 ${character.name}。用户说：「${userContent || ''}」。请自然回应。${character.personality ? `性格：${character.personality}` : ''}`;
        } else {
          const prevNames = speakers.slice(0, positionIndex)
            .map((id) => this.characterStore.getCharacter(id)?.name).filter(Boolean).join('、');
          systemMsg = `你是 ${character.name}。用户说：「${userContent || ''}」。${prevNames} 已回应（见上文）。请自然接话。${character.personality ? `性格：${character.personality}` : ''}`;
        }
      } else {
        systemMsg = `你是 ${character.name}。你正在跟 ${peers.join('、')} 聊天。自然交流，像朋友一样。${round === 1 ? '刚聊起来，放轻松。' : '别重复老话题。'}${character.personality ? `性格：${character.personality}` : ''}`;
      }

      // Build messages: all context → role:'user' so AI doesn't confuse identity
      const messages: Array<{ role: Role; content: string }> = [
        { role: 'system', content: systemMsg },
        ...context.map((m) => ({
          role: 'user' as Role,
          content: m.speakerName && m.speakerName !== character.name
            ? `${m.speakerName} 说：${m.content}`
            : m.content
        }))
      ];

      // ── Call model ──────────────────────────────────────────
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

        // Finalize only if meaningful response
        if (isTrivial(fullContent)) {
          console.info(`[DiscussionEngine] ${character.name} 沉默（内容过短）`);
        } else {
          this.chatStore.finalizeStreamedMessage(messageId);
        }
      } catch (err) {
        this.chatStore.appendStreamChunk(messageId, `[错误] ${err instanceof Error ? err.message : '请求失败'}`);
        this.chatStore.finalizeStreamedMessage(messageId);
      }

      // Push to context for subsequent speakers
      context.push({
        role: 'assistant' as Role,
        speakerName: character.name,
        content: fullContent
      });
    }
  }
}
