import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { AppEvent } from '../../shared/types/chat.types';

@Injectable({ providedIn: 'root' })
export class EventBusService {
  private readonly subject = new Subject<AppEvent>();
  readonly events$ = this.subject.asObservable();

  emit(event: AppEvent): void {
    this.subject.next(event);
  }
}
