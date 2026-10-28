import { Cause, Effect } from "effect";

import {
  isPersistenceFailure,
  persistenceFailureReport,
  redactCause,
} from "@node-effect/application";

// Logs a failure to start or serve once, with any persistence failure reduced
// to its safe report, also when one arrives as a defect, as the worker's
// reporter does. Interruption is a normal shutdown, not a failure.
const reportApiFailure = (cause: Cause.Cause<unknown>) => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void;

  return Effect.logError(
    "API failed",
    redactCause(cause, isPersistenceFailure, persistenceFailureReport),
  );
};

export { reportApiFailure };
