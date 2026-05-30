import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { UiStore } from '../../store/ui.store';
import { ExecutionPlan } from '../../shared/types/chat.types';
import { DiscussionEngineService } from '../discussion/discussion-engine.service';
import { LlmService } from '../llm/llm.service';
import { MemoryService } from '../memory/memory.service';

@Injectable({ providedIn: 'root' })
export class ExecutionEngineService {
  constructor(
    private readonly llmService: LlmService,
    private readonly memoryService: MemoryService,
    private readonly discussionEngine: DiscussionEngineService,
    private readonly uiStore: UiStore,
    private readonly chatStore: ChatStore,
    private readonly characterStore: CharacterStore
  ) {}

  async execute(plan: ExecutionPlan): Promise<void> {
    for (const action of plan.actions) {
      switch (action.type) {
        case 'call_model': {
          const response = await this.llmService.chat(action.provider, {
            model: action.model,
            messages: action.messages,
            temperature: action.temperature
          });

          const characterName = this.characterStore.getCharacter(action.characterId)?.name ?? action.characterId;
          this.chatStore.addAiMessage(plan.roomId, action.characterId, `${characterName}: ${response.content}`);
          break;
        }
        case 'write_memory':
          this.memoryService.write(action);
          break;
        case 'trigger_discussion':
          await this.discussionEngine.run(plan.roomId, action.round, action.speakers);
          break;
        case 'ui_event':
          this.uiStore.update(action.event);
          break;
        default:
          break;
      }
    }
  }
}
