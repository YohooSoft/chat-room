import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Character } from '../../shared/types/chat.types';
import { CharacterStore } from '../../store/character.store';

interface CharacterForm {
  name: string;
  personality: string;
  background: string;
  promptMode: 'auto' | 'advanced';
  systemPrompt: string;
  provider: string;
  model: string;
  temperature: number;
}

interface NewCharacterForm {
  name: string;
  personality: string;
  background: string;
}

const DEFAULT_FORM: CharacterForm = {
  name: '',
  personality: '',
  background: '',
  promptMode: 'auto',
  systemPrompt: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.7
};

const DEFAULT_NEW_FORM: NewCharacterForm = {
  name: '',
  personality: '',
  background: ''
};

@Component({
  selector: 'app-character',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './character.component.html',
  styleUrl: './character.component.scss'
})
export class CharacterComponent {
  readonly characterStore = inject(CharacterStore);
  readonly characters = this.characterStore.characters;
  readonly selectedId = signal<string>('');
  readonly draft = signal<CharacterForm>(DEFAULT_FORM);
  readonly newCharacter = signal<NewCharacterForm>(DEFAULT_NEW_FORM);
  readonly providers = ['openai', 'claude', 'gemini', 'openai-compatible'];
  readonly selectedCharacter = computed(() => {
    const characters = this.characters();
    const currentId = this.selectedId();
    if (!characters.length) {
      return undefined;
    }
    return characters.find((character) => character.id === currentId) ?? characters[0];
  });

  constructor() {
    effect(() => {
      const characters = this.characters();
      const currentId = this.selectedId();
      if (!characters.length) {
        return;
      }
      if (!currentId || !characters.some((character) => character.id === currentId)) {
        this.selectedId.set(characters[0].id);
      }
    });

    effect(() => {
      const character = this.selectedCharacter();
      if (!character) {
        return;
      }
      this.draft.set({
        name: character.name,
        personality: character.personality,
        background: character.background,
        promptMode: character.promptMode,
        systemPrompt: character.systemPrompt ?? '',
        provider: character.model.provider,
        model: character.model.model,
        temperature: character.model.temperature
      });
    });
  }

  selectCharacter(characterId: string): void {
    this.selectedId.set(characterId);
  }

  updateDraft(update: Partial<CharacterForm>): void {
    this.draft.update((current) => ({ ...current, ...update }));
  }

  updateNewCharacter(update: Partial<NewCharacterForm>): void {
    this.newCharacter.update((current) => ({ ...current, ...update }));
  }

  saveCharacter(): void {
    const character = this.selectedCharacter();
    if (!character) {
      return;
    }
    const draft = this.draft();
    const name = draft.name.trim();
    if (!name) {
      return;
    }
    this.characterStore.updateCharacter(character.id, {
      name,
      personality: draft.personality.trim() || '待补充',
      background: draft.background.trim(),
      promptMode: draft.promptMode,
      systemPrompt:
        draft.promptMode === 'advanced' ? draft.systemPrompt.trim() || undefined : undefined,
      model: {
        provider: draft.provider,
        model: draft.model.trim(),
        temperature: Math.min(1, Math.max(0, draft.temperature))
      }
    });
  }

  createCharacter(): void {
    const form = this.newCharacter();
    const name = form.name.trim();
    if (!name) {
      return;
    }
    const character = this.characterStore.createCharacter({
      name,
      personality: form.personality.trim() || '待补充',
      background: form.background.trim()
    });
    this.newCharacter.set(DEFAULT_NEW_FORM);
    this.selectedId.set(character.id);
  }

  updateTemperature(value: string): void {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return;
    }
    this.updateDraft({ temperature: Math.min(1, Math.max(0, numeric)) });
  }

  trackById(_index: number, character: Character): string {
    return character.id;
  }

  relationEntries(
    character: Character
  ): Array<{ id: string; name: string; closeness: number; trust: number }> {
    const characterMap = this.characterStore.byId();
    return Object.entries(character.relations).map(([id, relation]) => ({
      id,
      name: characterMap[id]?.name ?? id,
      closeness: relation.closeness,
      trust: relation.trust
    }));
  }
}
