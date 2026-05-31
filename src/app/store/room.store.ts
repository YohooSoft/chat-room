import { Injectable, computed, signal } from '@angular/core';

import { Room } from '../shared/types/chat.types';
import { createId } from '../shared/utils/id.util';
import { StorageService } from '../core/storage/storage.service';

const DEFAULT_ROOM: Room = {
  id: 'main-room',
  name: '主舞台',
  characterIds: ['haiku']
};

@Injectable({ providedIn: 'root' })
export class RoomStore {
  private readonly roomsSignal = signal<Room[]>([]);
  private readonly activeRoomIdSignal = signal<string>('');

  readonly rooms = this.roomsSignal.asReadonly();
  readonly activeRoomId = this.activeRoomIdSignal.asReadonly();
  readonly activeRoom = computed(() =>
    this.roomsSignal().find((room) => room.id === this.activeRoomIdSignal()) ?? DEFAULT_ROOM
  );

  constructor(private readonly storageService: StorageService) {
    this.hydrate();
  }

  setActiveRoom(roomId: string): void {
    if (!this.roomsSignal().some((room) => room.id === roomId)) {
      return;
    }
    this.activeRoomIdSignal.set(roomId);
  }

  createRoom(name: string, characterIds: string[]): Room {
    const room: Room = {
      id: createId(),
      name: name.trim() || `房间 ${this.roomsSignal().length + 1}`,
      characterIds
    };
    const nextRooms = [...this.roomsSignal(), room];
    this.roomsSignal.set(nextRooms);
    this.persist(nextRooms);
    this.activeRoomIdSignal.set(room.id);
    return room;
  }

  updateRoom(roomId: string, update: Omit<Partial<Room>, 'id'>): void {
    const nextRooms = this.roomsSignal().map((room) =>
      room.id === roomId ? { ...room, ...update } : room
    );
    this.roomsSignal.set(nextRooms);
    this.persist(nextRooms);
  }

  deleteRoom(roomId: string): void {
    const nextRooms = this.roomsSignal().filter((room) => room.id !== roomId);
    if (nextRooms.length === 0) {
      // Keep at least one room — re-seed with default
      const fallback: Room = {
        ...DEFAULT_ROOM,
        id: createId(),
        name: '主舞台'
      };
      this.roomsSignal.set([fallback]);
      this.persist([fallback]);
      this.activeRoomIdSignal.set(fallback.id);
      return;
    }
    this.roomsSignal.set(nextRooms);
    this.persist(nextRooms);
    if (this.activeRoomIdSignal() === roomId) {
      this.activeRoomIdSignal.set(nextRooms[0].id);
    }
  }

  private hydrate(): void {
    const state = this.storageService.read();
    const rooms = Object.values(state.rooms);
    if (!rooms.length) {
      const seeded = [DEFAULT_ROOM];
      this.roomsSignal.set(seeded);
      this.persist(seeded);
      this.activeRoomIdSignal.set(DEFAULT_ROOM.id);
      return;
    }
    this.roomsSignal.set(rooms);
    this.activeRoomIdSignal.set(rooms[0].id);
  }

  private persist(rooms: Room[]): void {
    const state = this.storageService.read();
    state.rooms = rooms.reduce<Record<string, Room>>((acc, room) => {
      acc[room.id] = room;
      return acc;
    }, {});
    this.storageService.write(state);
  }
}
