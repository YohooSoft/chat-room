import { Injectable, computed, signal } from '@angular/core';

import { Character, CharacterModelConfig } from '../shared/types/chat.types';
import { createId } from '../shared/utils/id.util';
import { StorageService } from '../core/storage/storage.service';

const DEFAULT_CHARACTERS: Character[] = [
  {
    id: 'haiku',
    name: 'Haiku',
    personality: '幕后调度者，不参与对话，仅生成执行计划并输出到 Console',
    background: 'AI Drama Engine 核心调度引擎',
    promptMode: 'auto',
    isSystem: true,
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.7
    },
    relations: {}
  }
];

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.7;

/** System characters that cannot be deleted. */
const PROTECTED_CHARACTER_IDS = new Set(['haiku']);

@Injectable({ providedIn: 'root' })
export class CharacterStore {
  private readonly charactersSignal = signal<Character[]>([]);

  readonly characters = this.charactersSignal.asReadonly();
  readonly byId = computed(() =>
    this.charactersSignal().reduce<Record<string, Character>>((acc, character) => {
      acc[character.id] = character;
      return acc;
    }, {})
  );

  constructor(private readonly storageService: StorageService) {
    this.hydrate();
  }

  getCharacter(characterId: string): Character | undefined {
    return this.byId()[characterId];
  }

  createCharacter(input: Pick<Character, 'name'> & Partial<Character>): Character {
    const baseModel = this.resolveDefaultModel();
    const character: Character = {
      id: createId(),
      name: input.name.trim() || `角色 ${this.charactersSignal().length + 1}`,
      personality: input.personality ?? '待补充',
      background: input.background ?? '',
      promptMode: input.promptMode ?? 'auto',
      systemPrompt: input.promptMode === 'advanced' ? input.systemPrompt : undefined,
      model: {
        ...baseModel,
        ...input.model
      },
      relations: input.relations ?? {}
    };
    const nextCharacters = [...this.charactersSignal(), character];
    this.charactersSignal.set(nextCharacters);
    this.persist(nextCharacters);
    return character;
  }

  updateCharacter(characterId: string, update: Omit<Partial<Character>, 'id'>): void {
    const nextCharacters = this.charactersSignal().map((character) =>
      character.id === characterId ? { ...character, ...update } : character
    );
    this.charactersSignal.set(nextCharacters);
    this.persist(nextCharacters);
  }

  isProtected(characterId: string): boolean {
    return PROTECTED_CHARACTER_IDS.has(characterId);
  }

  deleteCharacter(characterId: string): void {
    if (this.isProtected(characterId)) {
      console.info(`[CharacterStore] 角色 ${characterId} 为系统保护角色，不可删除`);
      return;
    }
    const nextCharacters = this.charactersSignal().filter(
      (character) => character.id !== characterId
    );
    if (nextCharacters.length === 0) {
      const fallback: Character = {
        id: createId(),
        name: '默认角色',
        personality: '待补充',
        background: '',
        promptMode: 'auto',
        model: {
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
          temperature: DEFAULT_TEMPERATURE
        },
        relations: {}
      };
      this.charactersSignal.set([fallback]);
      this.persist([fallback]);
      return;
    }
    this.charactersSignal.set(nextCharacters);
    this.persist(nextCharacters);
  }

  private hydrate(): void {
    const state = this.storageService.read();
    const characters = Object.values(state.characters);
    if (!characters.length) {
      this.charactersSignal.set(DEFAULT_CHARACTERS);
      this.persist(DEFAULT_CHARACTERS);
      return;
    }
    // Ensure system characters retain their isSystem flag
    const patched = characters.map((c) =>
      PROTECTED_CHARACTER_IDS.has(c.id) && c.id === 'haiku'
        ? { ...c, isSystem: true as const }
        : c
    );
    this.charactersSignal.set(patched);
  }

  private persist(characters: Character[]): void {
    const state = this.storageService.read();
    state.characters = characters.reduce<Record<string, Character>>((acc, character) => {
      acc[character.id] = character;
      return acc;
    }, {});
    this.storageService.write(state);
  }

  private resolveDefaultModel(): CharacterModelConfig {
    const state = this.storageService.read();
    const preferences = state.user.preferences as {
      defaultProvider?: string;
      defaultModel?: string;
      defaultTemperature?: number;
    };
    return {
      provider: preferences.defaultProvider ?? DEFAULT_PROVIDER,
      model: preferences.defaultModel ?? DEFAULT_MODEL,
      temperature:
        typeof preferences.defaultTemperature === 'number'
          ? preferences.defaultTemperature
          : DEFAULT_TEMPERATURE
    };
  }
}
