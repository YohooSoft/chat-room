import { Injectable } from '@angular/core';

import { CharacterStore } from '../../store/character.store';
import { ChatStore } from '../../store/chat.store';
import { LlmService } from '../llm/llm.service';

const MAX_SPEAKERS_PER_ROUND = 5;

@Injectable({ providedIn: 'root' })
export class DiscussionEngineService {
  constructor(
    private readonly characterStore: CharacterStore,
    private readonly llmService: LlmService,
    private readonly chatStore: ChatStore
  ) {}

  async run(roomId: string, round: number, speakers: string[]): Promise<void> {
    const speakerCount = Math.max(1, Math.min(round, MAX_SPEAKERS_PER_ROUND));

    for (const speakerId of speakers.slice(0, speakerCount)) {
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
