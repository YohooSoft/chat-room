import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Character } from '../../shared/types/chat.types';
import { CharacterStore } from '../../store/character.store';
import { StorageService } from '../../core/storage/storage.service';

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

interface RelationEditor {
  targetId: string;
  closeness: number;
  trust: number;
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

const DEFAULT_RELATION_EDITOR: RelationEditor = {
  targetId: '',
  closeness: 0.5,
  trust: 0.5
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
  private readonly storageService = inject(StorageService);
  readonly characters = this.characterStore.characters;
  readonly selectedId = signal<string>('');
  readonly draft = signal<CharacterForm>(DEFAULT_FORM);
  readonly newCharacter = signal<NewCharacterForm>(DEFAULT_NEW_FORM);
  readonly providers = ['openai', 'claude', 'gemini', 'openai-compatible'];
  readonly relationEditor = signal<RelationEditor>({ ...DEFAULT_RELATION_EDITOR });
  readonly editingRelation = signal<string>('');
  readonly selectedCharacter = computed(() => {
    const characters = this.characters();
    const currentId = this.selectedId();
    if (!characters.length) {
      return undefined;
    }
    return characters.find((character) => character.id === currentId) ?? characters[0];
  });
  readonly availableTargets = computed(() => {
    const selected = this.selectedCharacter();
    return this.characters().filter(
      (c) => c.id !== (selected?.id ?? '')
    );
  });
  /** All custom models from Settings → Model Management. */
  readonly allCustomModels = computed(() => {
    const state = this.storageService.state();
    const customModels = (state.user.preferences as Record<string, unknown>)
      ?.['customModels'] as Array<{ provider: string; model: string; apiKey?: string; baseUrl?: string; isGenAI?: boolean }> | undefined;
    return customModels ?? [];
  });

  /** Custom models filtered by the currently selected provider. */
  readonly modelsForProvider = computed(() =>
    this.allCustomModels().filter((m) => m.provider === this.draft().provider)
  );

  /** Whether the selected model matches a custom model entry (vs free-text). */
  readonly selectedModelIsCustom = computed(() =>
    this.modelsForProvider().some((m) => m.model === this.draft().model)
  );

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

  deleteCharacter(characterId: string): void {
    this.characterStore.deleteCharacter(characterId);
    if (this.selectedId() === characterId) {
      const characters = this.characterStore.characters();
      this.selectedId.set(characters.length ? characters[0].id : '');
    }
  }

  startAddRelation(): void {
    this.relationEditor.set({ ...DEFAULT_RELATION_EDITOR });
    this.editingRelation.set('');
  }

  startEditRelation(targetId: string): void {
    const character = this.selectedCharacter();
    const existing = character?.relations[targetId];
    if (!existing) {
      return;
    }
    this.relationEditor.set({
      targetId,
      closeness: existing.closeness,
      trust: existing.trust
    });
    this.editingRelation.set(targetId);
  }

  cancelRelationEdit(): void {
    this.editingRelation.set('');
  }

  saveRelation(): void {
    const character = this.selectedCharacter();
    const editor = this.relationEditor();
    if (!character || !editor.targetId.trim()) {
      return;
    }
    const nextRelations = { ...character.relations };
    nextRelations[editor.targetId] = {
      closeness: Math.min(1, Math.max(0, editor.closeness)),
      trust: Math.min(1, Math.max(0, editor.trust))
    };
    this.characterStore.updateCharacter(character.id, { relations: nextRelations });
    this.cancelRelationEdit();
  }

  deleteRelation(targetId: string): void {
    const character = this.selectedCharacter();
    if (!character) {
      return;
    }
    const nextRelations = { ...character.relations };
    delete nextRelations[targetId];
    this.characterStore.updateCharacter(character.id, { relations: nextRelations });
    if (this.editingRelation() === targetId) {
      this.cancelRelationEdit();
    }
  }

  updateRelationTarget(targetId: string): void {
    this.relationEditor.update((current) => ({ ...current, targetId }));
  }

  updateRelationCloseness(value: string): void {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return;
    }
    this.relationEditor.update((current) => ({
      ...current,
      closeness: Math.min(1, Math.max(0, numeric))
    }));
  }

  updateRelationTrust(value: string): void {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return;
    }
    this.relationEditor.update((current) => ({
      ...current,
      trust: Math.min(1, Math.max(0, numeric))
    }));
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
