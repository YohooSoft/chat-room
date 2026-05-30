import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { LlmService } from '../llm/llm.service';

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore
  ) {}

  async run(roomId: string, round: number, speakers: string[]): Promise<void> {
    for (const speakerId of speakers.slice(0, Math.max(1, Math.min(round, 5)))) {
      const character = this.characterStore.getCharacter(speakerId);
      if (!character) {
        continue;
      }

      const response = await this.llmService.chat(character.model.provider, {
        model: character.model.model,
        temperature: character.model.temperature,
        messages: [{ role: 'system', content: `讨论轮次 ${round}` }]
      });

      this.chatStore.addAiMessage(roomId, character.id, response.content);
    }
  }
}
