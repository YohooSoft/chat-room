import { Routes } from '@angular/router';

import { ChatComponent } from './features/chat/chat.component';
import { CharacterComponent } from './features/character/character.component';
import { MemoryComponent } from './features/memory/memory.component';
import { RoomComponent } from './features/room/room.component';
import { SettingsComponent } from './features/settings/settings.component';

export const routes: Routes = [
  { path: '', component: ChatComponent },
  { path: 'room', component: RoomComponent },
  { path: 'character', component: CharacterComponent },
  { path: 'memory', component: MemoryComponent },
  { path: 'settings', component: SettingsComponent }
];
