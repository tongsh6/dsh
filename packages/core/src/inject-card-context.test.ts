import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { injectCardContext, type ProjectCardInjection } from "./inject-card-context.js";

/**
 * Verifies AsyncLocalStorage-based isolation for the Project Card injection
 * flag. Replaces the (mis-)pattern of running 144-trial benchmark to validate
 * race-condition fix — these are deterministic Node.js semantics that should
 * be covered by unit tests, not API-cost-expensive end-to-end runs.
 */

describe("injectCardContext (AsyncLocalStorage isolation)", () => {
  it("getStore() returns undefined outside of run()", () => {
    assert.equal(injectCardContext.getStore(), undefined);
  });

  it("getStore() inside run(true, fn) returns true", () => {
    injectCardContext.run(true, () => {
      assert.equal(injectCardContext.getStore(), true);
    });
  });

  it("getStore() inside run(false, fn) returns false", () => {
    injectCardContext.run(false, () => {
      assert.equal(injectCardContext.getStore(), false);
    });
  });

  it("getStore() inside run(customCard, fn) returns the custom card text", () => {
    const customCard = "## Project Card\n\n**Unknowns**\n- Build system";
    injectCardContext.run(customCard, () => {
      assert.equal(injectCardContext.getStore(), customCard);
    });
  });

  it("contexts do not leak: getStore() outside run() is undefined even after a prior run()", () => {
    injectCardContext.run(true, () => {
      assert.equal(injectCardContext.getStore(), true);
    });
    assert.equal(injectCardContext.getStore(), undefined);
  });

  it("nested run() shadows outer (closest enclosing wins)", () => {
    injectCardContext.run(true, () => {
      assert.equal(injectCardContext.getStore(), true);
      injectCardContext.run(false, () => {
        assert.equal(injectCardContext.getStore(), false);
      });
      // After inner exits, outer is restored
      assert.equal(injectCardContext.getStore(), true);
    });
  });

  it("context propagates across await (the core race-fix property)", async () => {
    // This is the property that fixes the race: when an async function awaits
    // and resumes, it sees the SAME store it had before the await, regardless
    // of what other contexts have done in the meantime.
    await injectCardContext.run(true, async () => {
      assert.equal(injectCardContext.getStore(), true);
      await new Promise((r) => setTimeout(r, 1));
      assert.equal(injectCardContext.getStore(), true, "context must survive await");
      await new Promise((r) => setImmediate(r));
      assert.equal(injectCardContext.getStore(), true, "context must survive setImmediate");
    });
  });

  it("CONCURRENT async chains see independent stores (the actual race-fix proof)", async () => {
    // Simulates the benchmark-pie-replicated.ts pattern: 3 worker Promises
    // each running in their own injectCardContext.run(value, fn). Each
    // worker must observe its OWN value at every await point, not be
    // contaminated by other workers' values.
    const workers = [true, false, true, false, true, false].map((flag, idx) =>
      injectCardContext.run(flag, async () => {
        // Each worker does multiple awaits + checks its store after each.
        // If ALS isolation is broken, some assert would see the wrong value.
        for (let step = 0; step < 5; step++) {
          await new Promise((r) => setTimeout(r, 1 + Math.random() * 3));
          assert.equal(
            injectCardContext.getStore(),
            flag,
            `worker ${idx} (flag=${flag}) saw ${injectCardContext.getStore()} at step ${step}`,
          );
        }
        return flag;
      })
    );

    const results = await Promise.all(workers);
    assert.deepEqual(results, [true, false, true, false, true, false]);
  });

  it("ALS isolation holds under Promise.race + Promise.all interleaving", async () => {
    // More aggressive interleaving: each worker awaits race(timer, setImmediate).
    async function worker(flag: boolean, label: string): Promise<boolean> {
      return injectCardContext.run(flag, async () => {
        await Promise.race([
          new Promise((r) => setTimeout(r, Math.random() * 5)),
          new Promise((r) => setImmediate(r)),
        ]);
        const observed = injectCardContext.getStore();
        assert.equal(observed, flag, `worker ${label} contaminated: saw ${observed}`);
        return observed === flag;
      });
    }

    const ok = await Promise.all([
      worker(true, "A"), worker(false, "B"), worker(true, "C"),
      worker(false, "D"), worker(true, "E"), worker(false, "F"),
      worker(true, "G"), worker(false, "H"),
    ]);
    assert.equal(ok.every(Boolean), true);
  });

  it("context is preserved across helper function calls (not just inline arrow)", async () => {
    async function deep1(): Promise<ProjectCardInjection | undefined> {
      await new Promise((r) => setTimeout(r, 1));
      return deep2();
    }
    async function deep2(): Promise<ProjectCardInjection | undefined> {
      await new Promise((r) => setImmediate(r));
      return injectCardContext.getStore();
    }
    const a = await injectCardContext.run(true, deep1);
    const b = await injectCardContext.run(false, deep1);
    assert.equal(a, true);
    assert.equal(b, false);
  });
});
