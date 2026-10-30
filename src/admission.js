// Bounded in-memory admission. IP identifies a network, never an authenticated user.
export function createAdmission({
  maxConcurrent,
  requestsPerMinute,
  burst,
  clientRequestsPerMinute,
  clientBurst,
  maxClients,
  maxQueued = 128,
  maxQueuedPerClient = 112,
  maxActivePerClient = 8,
  maxQueueWaitMs = 15000,
}) {
  const clients = new Map();
  const queue = [];
  const networks = [];
  let active = 0,
    tokens = burst,
    last = Date.now(),
    closed = false;
  function drain() {
    const now = Date.now();
    tokens = Math.min(
      burst,
      tokens + ((now - last) * requestsPerMinute) / 60000,
    );
    last = now;
    for (const [key, c] of clients) {
      c.tokens = Math.min(
        clientBurst,
        c.tokens + ((now - c.last) * clientRequestsPerMinute) / 60000,
      );
      c.last = now;
      if (!c.active && !c.queued && now - c.used > 60000) clients.delete(key);
    }
    for (let i = queue.length - 1; i >= 0; i--)
      if (
        queue[i].signal.aborted ||
        now - queue[i].created >= maxQueueWaitMs ||
        closed
      ) {
        const item = queue.splice(i, 1)[0];
        item.client.queued--;
        item.resolve(null);
      }
    // Rotate network identities, not requests. Remove empty networks after expiry
    // or cancellation so the cursor remains bounded by the request queue.
    for (let i = networks.length - 1; i >= 0; i--)
      if (!queue.some((q) => q.key === networks[i])) networks.splice(i, 1);
    while (!closed && active < maxConcurrent && tokens >= 1) {
      let index = -1;
      for (let remaining = networks.length; remaining > 0; remaining--) {
        const key = networks.shift();
        networks.push(key);
        index = queue.findIndex(
          (q) =>
            q.key === key &&
            q.client.tokens >= 1 &&
            q.client.active < maxActivePerClient,
        );
        if (index >= 0) break;
      }
      if (index < 0) break;
      const item = queue.splice(index, 1)[0];
      const c = item.client;
      c.queued--;
      c.active++;
      c.tokens--;
      c.used = now;
      tokens--;
      active++;
      if (!c.queued) networks.splice(networks.indexOf(item.key), 1);
      let released = false;
      item.resolve(() => {
        if (released) return;
        released = true;
        c.active--;
        active--;
        c.used = Date.now();
        drain();
      });
    }
  }
  const timer = setInterval(drain, 25);
  timer.unref();
  return {
    acquire(key, signal) {
      drain();
      if (closed || signal.aborted) return Promise.resolve(null);
      let c = clients.get(key);
      if (!c) {
        if (clients.size >= maxClients) return Promise.resolve(null);
        c = {
          tokens: clientBurst,
          last: Date.now(),
          used: Date.now(),
          active: 0,
          queued: 0,
        };
        clients.set(key, c);
      }
      if (queue.length >= maxQueued || c.queued >= maxQueuedPerClient)
        return Promise.resolve(null);
      c.queued++;
      c.used = Date.now();
      return new Promise((resolve) => {
        if (!networks.includes(key)) networks.push(key);
        queue.push({ key, client: c, signal, created: Date.now(), resolve });
        drain();
      });
    },
    close() {
      closed = true;
      clearInterval(timer);
      drain();
    },
    stats() {
      return { active, queued: queue.length, clients: clients.size };
    },
  };
}
