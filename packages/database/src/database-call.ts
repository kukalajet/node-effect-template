import { type Duration, Effect, Schema } from "effect";

import { AppConfig } from "@node-effect/config";

import { diagnosticsFromCause } from "./error-diagnostics.ts";
import { databaseCallTimeout } from "./postgres.ts";

type FailureProps<Operation extends string> = {
  readonly operation: Operation;
  readonly cause: unknown;
  readonly diagnostics: ReturnType<typeof diagnosticsFromCause>;
};

// How an adapter calls the database: every call is bounded by `timeout`, and
// fails as `FailureClass` for its operation with diagnostics read from the cause.
// The timeout is required because PostgreSQL's own limits cannot fire when the
// server stops answering (see databaseCallTimeout); repositories get that
// limit from repositoryCalls, and readiness passes a shorter one of its own.
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

  // Runs `query` like `run`, then decodes the rows it returns with `schema`,
  // so stored data that is no longer valid fails as a persistence failure for
  // `operation`, never as a domain error. `schema` describes the whole result:
  // `Schema.Array(RowSchema)` for any number of rows, or
  // `Schema.Tuple([RowSchema])` for exactly one.
  const rows = <S extends Schema.Constraint, R, DomainError = never>(
    operation: Operation,
    query: Effect.Effect<unknown, unknown, R>,
    schema: S,
    refine?: (cause: unknown) => DomainError | undefined,
  ): Effect.Effect<
    S["Type"],
    Failure | DomainError,
    R | S["DecodingServices"]
  > => {
    const decode = Schema.decodeUnknownEffect(schema);

    return run(operation, query, refine).pipe(
      Effect.flatMap((result) =>
        decode(result).pipe(
          Effect.mapError((cause) => toFailure(operation, cause)),
        ),
      ),
    );
  };

  return { run, rows };
};

// How a repository calls the database: `databaseCalls` bounded by the longest
// the configured statement timeout and the pool wait allow, so a feature
// adapter needs neither the configuration nor the limit's formula.
const repositoryCalls = <Operation extends string, Failure>(
  FailureClass: new (props: FailureProps<Operation>) => Failure,
) =>
  AppConfig.pipe(
    Effect.map((config) =>
      databaseCalls(
        FailureClass,
        databaseCallTimeout(config.databaseStatementTimeoutMs),
      ),
    ),
  );

export { databaseCalls, repositoryCalls };
