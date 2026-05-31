import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { UiStore } from '../../store/ui.store';
import { ExecutionPlan } from '../../shared/types/chat.types';
import { DiscussionEngineService } from '../discussion/discussion-engine.service';
import { RelationEvolutionService } from '../discussion/relation-evolution.service';
import { UserAffinityService } from '../haiku/user-affinity.service';
import { LlmService } from '../llm/llm.service';
import { MemoryService } from '../memory/memory.service';

@Injectable({ providedIn: 'root' })
export class ExecutionEngineService {
  constructor(
    private readonly llmService: LlmService,
    private readonly memoryService: MemoryService,
    private readonly discussionEngine: DiscussionEngineService,
    private readonly relationEvolution: RelationEvolutionService,
    private readonly userAffinity: UserAffinityService,
    private readonly characterStore: CharacterStore,
    private readonly uiStore: UiStore,
    private readonly chatStore: ChatStore
  ) {}

  async execute(plan: ExecutionPlan): Promise<void> {
    const participants = new Set<string>();

    for (const action of plan.actions) {
      switch (action.type) {
        case 'call_model': {
          participants.add(action.characterId);
          const messageId = this.chatStore.beginStreamingMessage(
            plan.roomId,
            action.characterId
          );

          try {
            const stream = this.llmService.chatStream(action.provider, {
              model: action.model,
              messages: action.messages,
              temperature: action.temperature
            });

            for await (const chunk of stream) {
              this.chatStore.appendStreamChunk(messageId, chunk);
            }

            this.chatStore.finalizeStreamedMessage(messageId);
          } catch {
            this.chatStore.finalizeStreamedMessage(messageId);
          }
          break;
        }
        case 'write_memory':
          this.memoryService.write(action);
          break;
        case 'trigger_discussion':
          action.speakers.forEach((id) => participants.add(id));
          await this.discussionEngine.run(plan.roomId, action.round, action.speakers, action.userContent);
          break;
        case 'ui_event':
          this.uiStore.update(action.event);
          break;
        case 'system_message':
          this.chatStore.addAiMessage(plan.roomId, '系统', action.content);
          break;
        default:
          break;
      }
    }

    // ── Evolve character relations after the turn ──────────────────
    if (participants.size >= 2) {
      const recentMessages = this.chatStore.messagesForRoom(plan.roomId).slice(-10);
      this.relationEvolution.evolve(recentMessages, [...participants]);
    }

    // ── Evaluate user↔character affinity (Haiku judges) ────────────
    // Exclude system characters (Haiku = the invisible hand, not a person)
    const visibleParticipants = [...participants].filter((id) => {
      const c = this.characterStore.getCharacter(id);
      return c && !c.isSystem;
    });
    if (visibleParticipants.length >= 1) {
      const recentMessages = this.chatStore.messagesForRoom(plan.roomId).slice(-10);
      const nameMap = new Map<string, string>();
      for (const id of visibleParticipants) {
        const c = this.characterStore.getCharacter(id);
        if (c) nameMap.set(id, c.name);
      }
      this.userAffinity.evaluate(visibleParticipants, recentMessages, nameMap);
    }
  }
}
