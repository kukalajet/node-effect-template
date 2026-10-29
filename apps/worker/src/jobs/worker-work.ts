import { Cause, Effect, Schedule } from "effect";

import { sampleUsersPass } from "./sample-users.ts";

type WorkerJob = {
  // Names the job in its pass timeout's TimeoutError.
  readonly name: string;
  readonly pass: () => Effect.Effect<void, unknown, unknown>;
};

// Every job the worker runs. Add a job here, and both the one-shot pass and
// the polling loops run it.
const workerJobs = [
  { name: "sample-users", pass: sampleUsersPass },
] as const satisfies ReadonlyArray<WorkerJob>;

type WorkerJobEntry = (typeof workerJobs)[number];

// A pass that never finishes would stall its loop without failing the worker,
// so nothing would restart it. Past `timeoutMs` the pass is interrupted, so its
// open transaction never commits, and fails with a TimeoutError that names the
// job. Passes stay interruptible, so SIGTERM stops one too. Either waits for
// the interrupted pass to finish: a query in flight takes the driver up to 5
// seconds to cancel when the server does not answer.
const runJobPass = (job: WorkerJobEntry, timeoutMs: number) =>
  job.pass().pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.fail(
          new Cause.TimeoutError(
            `Worker job ${job.name} ran longer than its ${timeoutMs} ms pass timeout`,
          ),
        ),
    }),
  );

// One pass of every job, in order. `once.ts` runs this.
const processWorkerWorkPass = Effect.fn("Worker.processWorkerWorkPass")(
  function* (passTimeoutMs: number) {
    yield* Effect.forEach(workerJobs, (job) => runJobPass(job, passTimeoutMs), {
      discard: true,
    });
  },
);

// Each job polls on its own loop, so a slow job never delays another. A loop
// waits `intervalMs` after a pass finishes, so passes of one job never overlap.
// The first failure interrupts every loop and fails the worker; the process
// supervisor (Compose `restart: unless-stopped`) starts it again. The loops run
// outside any span, so each pass starts a trace of its own.
const pollWorkerWork = (options: {
  readonly intervalMs: number;
  readonly passTimeoutMs: number;
}) =>
  Effect.forEach(
    workerJobs,
    (job) =>
      runJobPass(job, options.passTimeoutMs).pipe(
        Effect.repeat(Schedule.spaced(options.intervalMs)),
      ),
    { concurrency: "unbounded", discard: true },
  );

export { pollWorkerWork, processWorkerWorkPass };
