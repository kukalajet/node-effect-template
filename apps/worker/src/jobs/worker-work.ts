import { Effect, Schedule } from "effect";

import { sampleUsersPass } from "./sample-users.ts";

// One pass of every job, in order. `once.ts` runs this.
const processWorkerWorkPass = Effect.fn("Worker.processWorkerWorkPass")(
  function* () {
    yield* sampleUsersPass();
  },
);

// Each job polls on its own loop, so a slow job never delays another. A loop
// waits `intervalMs` after a pass finishes, so passes of one job never overlap.
// The first failure interrupts every loop and fails the worker; the process
// supervisor (Compose `restart: unless-stopped`) starts it again.
const pollWorkerWork = Effect.fn("Worker.pollWorkerWork")(
  (intervalMs: number) =>
    Effect.all(
      [sampleUsersPass().pipe(Effect.repeat(Schedule.spaced(intervalMs)))],
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid),
);

export { pollWorkerWork, processWorkerWorkPass };
