import { Injectable, computed, signal } from '@angular/core';

import { Room } from '../shared/types/chat.types';

const DEFAULT_ROOM: Room = {
  id: 'main-room',
  name: '主舞台',
  characterIds: ['director', 'critic']
};

@Injectable({ providedIn: 'root' })
export class RoomStore {
  private readonly roomsSignal = signal<Room[]>([DEFAULT_ROOM]);
  private readonly activeRoomIdSignal = signal<string>(DEFAULT_ROOM.id);

  readonly rooms = this.roomsSignal.asReadonly();
  readonly activeRoomId = this.activeRoomIdSignal.asReadonly();
  readonly activeRoom = computed(() =>
    this.roomsSignal().find((room) => room.id === this.activeRoomIdSignal()) ?? DEFAULT_ROOM
  );

  setActiveRoom(roomId: string): void {
    this.activeRoomIdSignal.set(roomId);
  }
}
