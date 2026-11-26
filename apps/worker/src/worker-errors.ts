import type { Cause } from "effect";
import { Effect } from "effect";

import { reportFailure } from "@node-effect/application";
import { databaseFailureRedaction } from "@node-effect/database";

// Logs a failure once, as every entry point does: a persistence failure by its
// safe diagnostics, also when one arrives as a defect, and nothing for
// interruption. A raw database error, such as the SqlError for a DATABASE_URL
// that does not parse, which arrives while the services are built, is reduced
// the same way. Any other failure keeps its details: a pass timeout's
// TimeoutError names the job and the limit, and anything else is unexpected.
const reportWorkerFailure = (cause: Cause.Cause<unknown>) =>
  reportFailure(
    "Worker failed",
    databaseFailureRedaction,
  )(cause).pipe(Effect.annotateLogs({ service: "worker" }));

export { reportWorkerFailure };
