import { describe, expect, it, vi } from "vitest";
import { FocusReadingTransitionCoordinator } from "../reader/readerFocusTransition";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("focus reading transition coordinator", () => {
  it("shares one in-flight transition across rapid repeated requests", async () => {
    const coordinator = new FocusReadingTransitionCoordinator();
    const gate = deferred();
    let confirmed = false;
    const operations = {
      prepare: vi.fn(),
      perform: vi.fn(async () => {
        await gate.promise;
        confirmed = true;
      }),
      confirmed: () => confirmed,
      commit: vi.fn(),
      rollback: vi.fn(),
    };

    const first = coordinator.run("entering", operations);
    const second = coordinator.run("entering", operations);
    expect(first).toBe(second);
    expect(operations.perform).toHaveBeenCalledTimes(1);

    gate.resolve();
    await expect(first).resolves.toMatchObject({ committed: true, stale: false });
    expect(operations.commit).toHaveBeenCalledTimes(1);
  });

  it("rolls back a rejected or unconfirmed fullscreen request", async () => {
    const coordinator = new FocusReadingTransitionCoordinator();
    const rollback = vi.fn();
    const result = await coordinator.run("entering", {
      prepare: vi.fn(),
      perform: async () => undefined,
      confirmed: () => false,
      commit: vi.fn(),
      rollback,
    });

    expect(result.committed).toBe(false);
    expect(result.stale).toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(coordinator.getPhase()).toBe("idle");
  });

  it("does not commit a generation invalidated while fullscreen is pending", async () => {
    const coordinator = new FocusReadingTransitionCoordinator();
    const gate = deferred();
    const commit = vi.fn();
    const rollback = vi.fn();
    const transition = coordinator.run("entering", {
      prepare: vi.fn(),
      perform: () => gate.promise,
      confirmed: () => true,
      commit,
      rollback,
    });

    coordinator.invalidate();
    gate.resolve();
    await expect(transition).resolves.toMatchObject({ committed: false, stale: true });
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });
});
