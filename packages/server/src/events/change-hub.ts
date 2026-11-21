import { EventEmitter } from 'node:events';

/**
 * "Something in this project changed" signals for the board: tasks were created, started or
 * finished, a plan moved on. The web UI listens on one SSE stream per project and re-reads what
 * it shows, instead of polling (the scheduler starts tasks on its own, so the page cannot know).
 */
export class ChangeHub extends EventEmitter<{ change: [projectId: string] }> {
  constructor() {
    super();
    // One listener per open browser tab; do not warn at 10.
    this.setMaxListeners(0);
  }

  notify(projectId: string): void {
    this.emit('change', projectId);
  }
}
