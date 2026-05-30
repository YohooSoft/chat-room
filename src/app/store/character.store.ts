import { Injectable, computed, signal } from '@angular/core';

import { Character } from '../shared/types/chat.types';

const DEFAULT_CHARACTERS: Character[] = [
  {
    id: 'director',
    name: '导演AI',
    personality: '擅长推进剧情和分配角色任务',
    background: '戏剧总导演',
    promptMode: 'auto',
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.7
    },
    relations: {}
  },
  {
    id: 'critic',
    name: '评论家AI',
    personality: '关注逻辑一致性和人物动机',
    background: '戏剧评论家',
    promptMode: 'auto',
    model: {
      provider: 'claude',
      model: 'claude-3-5-sonnet',
      temperature: 0.6
    },
    relations: {}
  }
];

@Injectable({ providedIn: 'root' })
export class CharacterStore {
  private readonly charactersSignal = signal<Character[]>(DEFAULT_CHARACTERS);

  readonly characters = this.charactersSignal.asReadonly();
  readonly byId = computed(() =>
    this.charactersSignal().reduce<Record<string, Character>>((acc, character) => {
      acc[character.id] = character;
      return acc;
    }, {})
  );

  getCharacter(characterId: string): Character | undefined {
    return this.byId()[characterId];
  }
}
