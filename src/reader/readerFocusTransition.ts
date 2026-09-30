export type FocusTransitionPhase = "idle" | "entering" | "exiting";

export interface FocusTransitionOperations {
  prepare: () => void;
  perform: () => Promise<void>;
  confirmed: () => boolean;
  commit: () => void | Promise<void>;
  rollback: (error: unknown) => void | Promise<void>;
}

export interface FocusTransitionResult {
  generation: number;
  committed: boolean;
  stale: boolean;
  error?: unknown;
}

export class FocusReadingTransitionCoordinator {
  private generation = 0;
  private phase: FocusTransitionPhase = "idle";
  private active: Promise<FocusTransitionResult> | null = null;

  getPhase(): FocusTransitionPhase {
    return this.phase;
  }

  getGeneration(): number {
    return this.generation;
  }

  run(
    phase: Exclude<FocusTransitionPhase, "idle">,
    operations: FocusTransitionOperations,
  ): Promise<FocusTransitionResult> {
    if (this.active) return this.active;
    const generation = ++this.generation;
    this.phase = phase;
    operations.prepare();
    const request = this.execute(generation, operations).finally(() => {
      if (this.active === request) {
        this.active = null;
        this.phase = "idle";
      }
    });
    this.active = request;
    return request;
  }

  invalidate(): void {
    this.generation += 1;
    this.active = null;
    this.phase = "idle";
  }

  private async execute(
    generation: number,
    operations: FocusTransitionOperations,
  ): Promise<FocusTransitionResult> {
    try {
      await operations.perform();
      if (generation !== this.generation) {
        return { generation, committed: false, stale: true };
      }
      if (!operations.confirmed()) throw new Error("Fullscreen state was not confirmed.");
      await operations.commit();
      return { generation, committed: true, stale: false };
    } catch (error) {
      if (generation !== this.generation) {
        return { generation, committed: false, stale: true, error };
      }
      await operations.rollback(error);
      return { generation, committed: false, stale: false, error };
    }
  }
}
