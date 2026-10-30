import test from "node:test";
import assert from "node:assert/strict";
import { createAdmission } from "../src/admission.js";
const options = {
  maxConcurrent: 2,
  requestsPerMinute: 60000,
  burst: 100,
  clientRequestsPerMinute: 60000,
  clientBurst: 100,
  maxClients: 10,
  maxQueued: 3,
  maxQueuedPerClient: 2,
  maxActivePerClient: 1,
  maxQueueWaitMs: 100,
};
const signal = () => new AbortController().signal;
test("admission queue bounds, per-network isolation, timeout and recovery", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
  const a = createAdmission(options);
  try {
    const first = await a.acquire("nat", signal());
    const pending = a.acquire("nat", signal());
    const secondPending = a.acquire("nat", signal());
    assert.equal(await a.acquire("nat", signal()), null);
    const other = await a.acquire("other", signal());
    assert.equal(typeof other, "function");
    assert.deepEqual(a.stats(), { active: 2, queued: 2, clients: 2 });
    first();
    const release = await pending;
    assert.equal(typeof release, "function");
    release();
    const release2 = await secondPending;
    release2();
    other();
    assert.equal(a.stats().active, 0);
    const block = await a.acquire("nat", signal());
    const timeout = a.acquire("nat", signal());
    t.mock.timers.tick(99);
    assert.equal(a.stats().queued, 1);
    t.mock.timers.tick(1);
    assert.equal(await timeout, null);
    block();
    const cancel = new AbortController();
    const held = await a.acquire("nat", signal());
    const cancelled = a.acquire("nat", cancel.signal);
    cancel.abort();
    t.mock.timers.tick(25);
    assert.equal(await cancelled, null);
    held();
  } finally {
    a.close();
  }
});
test("admission shutdown releases queued requests without granting work", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
  const a = createAdmission(options);
  const held = await a.acquire("x", signal());
  const queued = a.acquire("x", signal());
  a.close();
  assert.equal(await queued, null);
  held();
  assert.equal(a.stats().active, 0);
});

test("three contending networks rotate without starving the last network", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
  const a = createAdmission({
    ...options,
    maxConcurrent: 1,
    maxQueued: 12,
    maxQueuedPerClient: 4,
    maxQueueWaitMs: 1000,
  });
  try {
    const held = await a.acquire("held", signal());
    const order = [];
    const pending = ["A", "A", "A", "B", "B", "B", "C"].map((key) =>
      a.acquire(key, signal()).then((release) => {
        assert.equal(typeof release, "function");
        order.push(key);
        release();
      }),
    );
    held();
    await Promise.all(pending);
    assert.deepEqual(order, ["A", "B", "C", "A", "B", "A", "B"]);
    assert.equal(a.stats().active, 0);
    assert.equal(a.stats().queued, 0);
  } finally {
    a.close();
  }
});
