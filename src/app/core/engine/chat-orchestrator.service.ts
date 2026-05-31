import { DestroyRef, Injectable, inject } from '@angular/core';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EventBusService } from '../event-bus/event-bus.service';
import { HaikuService } from '../haiku/haiku.service';
import { ExecutionEngineService } from './execution-engine.service';

@Injectable({ providedIn: 'root' })
export class ChatOrchestratorService {
  private readonly destroyRef = inject(DestroyRef);
  private initialized = false;

  constructor(
    private readonly eventBusService: EventBusService,
    private readonly haikuService: HaikuService,
    private readonly executionEngineService: ExecutionEngineService
  ) {}

  init(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.listen();
  }

  private listen(): void {
    this.eventBusService.events$
      .pipe(
        filter((event) => event.type === 'user_message'),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(async (event) => {
        const plan = await this.haikuService.createPlan(event.roomId, event.content);
        void this.executionEngineService.execute(plan);
      });
  }
}
