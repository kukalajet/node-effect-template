import { Cause, Effect, Runtime } from "effect";
import { CliError } from "effect/cli";

import { reportFailure } from "@node-effect/application";

// Replaces a domain error, such as UserNotFound, with a message the user can
// act on: effect/cli prints it on standard error and the command exits 1. The
// domain error stays the UserError's cause, which nothing prints.
const userError = (message: string) => (cause: unknown) =>
  Effect.fail(new CliError.UserError({ cause, userMessage: message }));

// effect/cli shows these itself: invalid input, with the command's help, and a
// UserError's message. It then sets Runtime.errorReported to false on the
// error, so that no runner logs it again.
const isShownByCli = (reason: Cause.Reason<unknown>) =>
  Cause.isFailReason(reason) && !Runtime.getErrorReported(reason.error);

// Logs a failure once, as every entry point does: a persistence failure by its
// safe diagnostics, also when one arrives as a defect, and nothing for
// interruption or for what effect/cli has shown. Any other failure keeps its
// details: missing configuration names the variable, and anything else is
// unexpected.
const reportCliFailure = (cause: Cause.Cause<unknown>) => {
  const unshown = cause.reasons.filter((reason) => !isShownByCli(reason));

  if (unshown.length === 0) return Effect.void;

  return reportFailure("CLI failed")(Cause.fromReasons(unshown)).pipe(
    Effect.annotateLogs({ service: "cli" }),
  );
};

export { reportCliFailure, userError };
