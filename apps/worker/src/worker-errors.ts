import { Cause, Effect } from "effect";

import {
  isPersistenceFailure,
  persistenceFailureReport,
  redactCause,
} from "@node-effect/application";

// Logs a failure once. Interruption is a normal shutdown, not a failure.
//
// Repository errors carry their raw cause, which can hold SQL, parameters, and
// stored values, so they are reported by their safe diagnostics instead, also
// when one arrives as a defect. Any other failure keeps its details: a pass
// timeout's TimeoutError names the job and the limit, and anything else is
// unexpected.
const reportWorkerFailure = (cause: Cause.Cause<unknown>) => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void;

  const reportedCause = redactCause(
    cause,
    isPersistenceFailure,
    persistenceFailureReport,
  );

  return Effect.logError("Worker failed", reportedCause).pipe(
    Effect.annotateLogs({ service: "worker" }),
  );
};

export { reportWorkerFailure };
