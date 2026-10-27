import { Cause, Effect, Schedule } from "effect";

import { sampleUsersPass } from "./sample-users.ts";

// A pass that never finishes would stall its loop without failing the worker,
// so nothing would restart it. Past `timeoutMs` the pass is interrupted, so its
// open transaction never commits, and fails with a TimeoutError that names the
// job. Passes stay interruptible, so SIGTERM stops one too. Either waits for
// the interrupted pass to finish: a query in flight takes the driver up to 5
// seconds to cancel when the server does not answer.
const withPassTimeout = (job: string, timeoutMs: number) =>
  Effect.timeoutOrElse({
    duration: timeoutMs,
    orElse: () =>
      Effect.fail(
        new Cause.TimeoutError(
          `Worker job ${job} ran longer than its ${timeoutMs} ms pass timeout`,
        ),
      ),
  });

const sampleUsers = (passTimeoutMs: number) =>
  sampleUsersPass().pipe(withPassTimeout("sample-users", passTimeoutMs));

// One pass of every job, in order. `once.ts` runs this.
const processWorkerWorkPass = Effect.fn("Worker.processWorkerWorkPass")(
  function* (passTimeoutMs: number) {
    yield* sampleUsers(passTimeoutMs);
  },
);

// Each job polls on its own loop, so a slow job never delays another. A loop
// waits `intervalMs` after a pass finishes, so passes of one job never overlap.
// The first failure interrupts every loop and fails the worker; the process
// supervisor (Compose `restart: unless-stopped`) starts it again.
const pollWorkerWork = Effect.fn("Worker.pollWorkerWork")(
  (options: { readonly intervalMs: number; readonly passTimeoutMs: number }) =>
    Effect.all(
      [
        sampleUsers(options.passTimeoutMs).pipe(
          Effect.repeat(Schedule.spaced(options.intervalMs)),
        ),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid),
);

export { pollWorkerWork, processWorkerWorkPass };
