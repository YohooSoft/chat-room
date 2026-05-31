import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UiStore {
  private readonly typingSignal = signal<boolean>(false);
  private readonly turnEndedSignal = signal<boolean>(false);
  private readonly discussionPausedSignal = signal<{ roomId: string; speakers: string[] } | null>(null);

  readonly typing = this.typingSignal.asReadonly();
  readonly turnEnded = this.turnEndedSignal.asReadonly();
  readonly discussionPaused = this.discussionPausedSignal.asReadonly();

  update(event: 'typing' | 'stop_typing' | 'end_turn'): void {
    switch (event) {
      case 'typing':
        this.typingSignal.set(true);
        this.turnEndedSignal.set(false);
        return;
      case 'stop_typing':
        this.typingSignal.set(false);
        return;
      case 'end_turn':
        this.typingSignal.set(false);
        this.turnEndedSignal.set(true);
        return;
    }
  }

  pauseDiscussion(roomId: string, speakers: string[]): void {
    this.discussionPausedSignal.set({ roomId, speakers });
  }

  resumeDiscussion(): void {
    this.discussionPausedSignal.set(null);
  }
}
