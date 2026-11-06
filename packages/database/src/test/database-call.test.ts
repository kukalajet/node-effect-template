import { assert, describe, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Fiber, Schema } from "effect";
import { SqlError } from "effect/sql";
import { TestClock } from "effect/testing";

import { UserRepositoryError } from "@node-effect/application";

import { databaseCalls } from "../database-call.ts";

const calls = databaseCalls(UserRepositoryError, "1 second");

const authorizationError = new SqlError.SqlError({
  reason: new SqlError.AuthorizationError({
    cause: Object.assign(new Error("permission denied"), { code: "42501" }),
  }),
});

// What a query fails with when PostgreSQL reports a unique violation: Drizzle
// wraps the driver's SqlError in a cause of its own.
const uniqueViolation = (constraint: string) =>
  new EffectDrizzleQueryError({
    query: "insert into users",
    params: [],
    cause: Cause.fail(
      new SqlError.SqlError({
        reason: new SqlError.UniqueViolation({
          cause: new Error("duplicate key"),
          constraint,
        }),
      }),
    ),
  });

// Domain errors the tests map outcomes to.
const emailTaken = { _tag: "EmailTaken" } as const;
const usernameTaken = { _tag: "UsernameTaken" } as const;
const notFound = { _tag: "NotFound" } as const;

const EmailRow = Schema.Struct({ email: Schema.String });
const adaRow = { email: "ada@example.com" };
const graceRow = { email: "grace@example.com" };

describe("databaseCalls", () => {
  it.effect("fails as the operation's failure with safe diagnostics", () =>
    Effect.gen(function* () {
      const failure = yield* calls
        .run("findById", Effect.fail(authorizationError))
        .pipe(Effect.flip);

      assert.instanceOf(failure, UserRepositoryError);
      assert.strictEqual(failure.operation, "findById");
      assert.strictEqual(failure.cause, authorizationError);

      assert.deepStrictEqual(failure.diagnostics, {
        reason: "AuthorizationError",
        code: "42501",
      });
    }),
  );

  it.effect(
    "turns a unique violation on a mapped constraint into its domain error",
    () =>
      Effect.gen(function* () {
        const onUniqueViolation = {
          users_email_key: () => emailTaken,
          users_username_key: () => usernameTaken,
        };

        const byEmail = yield* calls
          .run("insert", Effect.fail(uniqueViolation("users_email_key")), {
            onUniqueViolation,
          })
          .pipe(Effect.flip);

        const byUsername = yield* calls
          .run("insert", Effect.fail(uniqueViolation("users_username_key")), {
            onUniqueViolation,
          })
          .pipe(Effect.flip);

        assert.strictEqual(byEmail, emailTaken);
        assert.strictEqual(byUsername, usernameTaken);
      }),
  );

  it.effect(
    "keeps a unique violation on any other constraint a persistence failure",
    () =>
      Effect.gen(function* () {
        const failure = yield* calls
          .run("insert", Effect.fail(uniqueViolation("users_pkey")), {
            onUniqueViolation: { users_email_key: () => emailTaken },
          })
          .pipe(Effect.flip);

        assert.instanceOf(failure, UserRepositoryError);
        assert.strictEqual(failure.operation, "insert");

        assert.deepStrictEqual(failure.diagnostics, {
          reason: "UniqueViolation",
        });
      }),
  );

  it.effect("fails a call that outlives its timeout as a TimeoutError", () =>
    Effect.gen(function* () {
      const fiber = yield* calls
        .run("list", Effect.never)
        .pipe(Effect.flip, Effect.forkScoped);

      yield* TestClock.adjust("999 millis");
      assert.isUndefined(fiber.pollUnsafe());

      yield* TestClock.adjust("1 millis");
      const failure = yield* Fiber.join(fiber);

      assert.instanceOf(failure, UserRepositoryError);
      assert.strictEqual(failure.operation, "list");
      assert.deepStrictEqual(failure.diagnostics, { reason: "TimeoutError" });
    }),
  );

  it.effect("one decodes the single row it expects", () =>
    Effect.gen(function* () {
      const row = yield* calls.one(
        "insert",
        Effect.succeed([adaRow]),
        EmailRow,
      );

      assert.deepStrictEqual(row, adaRow);
    }),
  );

  it.effect("one reports a missing row as a persistence failure", () =>
    Effect.gen(function* () {
      const failure = yield* calls
        .one("insert", Effect.succeed([]), EmailRow)
        .pipe(Effect.flip);

      assert.instanceOf(failure, UserRepositoryError);

      assert.deepStrictEqual(failure.diagnostics, {
        reason: "SchemaError",
        validationPaths: ["0"],
      });
    }),
  );

  it.effect("one reports a missing row as onMissing's domain error", () =>
    Effect.gen(function* () {
      const error = yield* calls
        .one("findById", Effect.succeed([]), EmailRow, {
          onMissing: () => notFound,
        })
        .pipe(Effect.flip);

      assert.strictEqual(error, notFound);
    }),
  );

  it.effect("one reports more than one row as a persistence failure", () =>
    Effect.gen(function* () {
      const failure = yield* calls
        .one("findById", Effect.succeed([adaRow, graceRow]), EmailRow, {
          onMissing: () => notFound,
        })
        .pipe(Effect.flip);

      assert.instanceOf(failure, UserRepositoryError);

      assert.deepStrictEqual(failure.diagnostics, {
        reason: "SchemaError",
        validationPaths: ["1"],
      });
    }),
  );

  it.effect("many decodes every row with the row schema", () =>
    Effect.gen(function* () {
      const rows = yield* calls.many(
        "list",
        Effect.succeed([adaRow, graceRow]),
        EmailRow,
      );

      assert.deepStrictEqual(rows, [adaRow, graceRow]);
    }),
  );

  it.effect(
    "reports rows that do not decode as a persistence failure, never a domain error",
    () =>
      Effect.gen(function* () {
        const failure = yield* calls
          .one("insert", Effect.succeed([{}]), EmailRow, {
            onUniqueViolation: { users_email_key: () => emailTaken },
            onMissing: () => notFound,
          })
          .pipe(Effect.flip);

        assert.instanceOf(failure, UserRepositoryError);
        assert.strictEqual(failure.operation, "insert");

        assert.deepStrictEqual(failure.diagnostics, {
          reason: "SchemaError",
          validationPaths: ["0.email"],
        });
      }),
  );
});
