import { Cause, Effect, Runtime } from "effect";
import { CliError } from "effect/cli";

import { reportFailure } from "@node-effect/application";

// Replaces a domain error, such as UserNotFound, with a message the user can
// act on: effect/cli prints it on standard error and the command exits 1. The
// domain error stays the UserError's cause, which nothing prints.
const userError = (message: string) => (cause: unknown) =>
  Effect.fail(new CliError.UserError({ cause, userMessage: message }));

// effect/cli handles a request for help and a UserError itself, and marks
// them with Runtime.errorReported set to false so that no runner logs them.
// ShowHelp, which it raises for invalid input and for a group run without a
// command and then prints the help for, carries the mark from the start; a
// UserError gets it once effect/cli has printed its message. A defect in
// cleanup turns a failure into a defect, so the mark is read on both, as
// runMain's own reporting reads it.
const isHandledByCli = (reason: Cause.Reason<unknown>) => {
  if (Cause.isFailReason(reason)) {
    return !Runtime.getErrorReported(reason.error);
  }

  if (Cause.isDieReason(reason)) {
    return !Runtime.getErrorReported(reason.defect);
  }

  return false;
};

// Logs a failure once, as every entry point does: a persistence failure by its
// safe diagnostics, also when one arrives as a defect, and nothing for
// interruption or for what effect/cli handles itself. Any other failure keeps
// its details: missing configuration names the variable, and anything else is
// unexpected.
const reportCliFailure = (cause: Cause.Cause<unknown>) => {
  const unhandled = cause.reasons.filter((reason) => !isHandledByCli(reason));

  if (unhandled.length === 0) return Effect.void;

  return reportFailure("CLI failed")(Cause.fromReasons(unhandled)).pipe(
    Effect.annotateLogs({ service: "cli" }),
  );
};

export { reportCliFailure, userError };
