import { Component, computed, effect, inject, signal } from '@angular/core';

import { Character } from '../../shared/types/chat.types';
import { CharacterStore } from '../../store/character.store';

@Component({
  selector: 'app-character',
  standalone: true,
  templateUrl: './character.component.html',
  styleUrl: './character.component.scss'
})
export class CharacterComponent {
  readonly characterStore = inject(CharacterStore);
  readonly characters = this.characterStore.characters;
  readonly selectedId = signal<string>(this.characters()[0]?.id ?? '');
  readonly selectedCharacter = computed(() => {
    const characters = this.characters();
    const currentId = this.selectedId();
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
  }

  selectCharacter(characterId: string): void {
    this.selectedId.set(characterId);
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
