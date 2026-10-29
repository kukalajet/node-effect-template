import { type Duration, Effect } from "effect";

import { diagnosticsFromCause } from "./error-diagnostics.ts";

type FailureProps<Operation extends string> = {
  readonly operation: Operation;
  readonly cause: unknown;
  readonly diagnostics: ReturnType<typeof diagnosticsFromCause>;
};

// How an adapter calls the database: every call is bounded by `timeout`, and
// fails as `FailureClass` for its operation with diagnostics read from the cause.
// The timeout is required because PostgreSQL's own limits cannot fire when the
// server stops answering (see databaseCallTimeout); repositories pass that
// limit, and readiness a shorter one of its own.
const databaseCalls = <Operation extends string, Failure>(
  FailureClass: new (props: FailureProps<Operation>) => Failure,
  timeout: Duration.Input,
) => {
  const toFailure = (operation: Operation, cause: unknown) =>
    new FailureClass({
      operation,
      cause,
      diagnostics: diagnosticsFromCause(cause),
    });

  // Fails as `Failure` for `operation`, for a step after the query, such as
  // decoding its rows.
  const failAs =
    (operation: Operation) =>
    <A, R>(effect: Effect.Effect<A, unknown, R>) =>
      effect.pipe(Effect.mapError((cause) => toFailure(operation, cause)));

  // `refine` turns a cause that means a domain outcome, such as a unique
  // violation on a known constraint, into that domain error; every other cause,
  // a timeout included, is a persistence failure.
  const run = <A, R, DomainError = never>(
    operation: Operation,
    query: Effect.Effect<A, unknown, R>,
    refine?: (cause: unknown) => DomainError | undefined,
  ): Effect.Effect<A, Failure | DomainError, R> =>
    query.pipe(
      Effect.timeout(timeout),
      Effect.mapError(
        (cause) => refine?.(cause) ?? toFailure(operation, cause),
      ),
    );

  return { run, failAs };
};

export { databaseCalls };
