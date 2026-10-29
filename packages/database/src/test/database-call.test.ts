import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { SqlError } from "effect/sql";
import { TestClock } from "effect/testing";

import { UserRepositoryError } from "@node-effect/application";
import { UserAlreadyExists } from "@node-effect/domain";

import { databaseCalls } from "../database-call.ts";

const calls = databaseCalls(UserRepositoryError, "1 second");

const authorizationError = new SqlError.SqlError({
  reason: new SqlError.AuthorizationError({
    cause: Object.assign(new Error("permission denied"), { code: "42501" }),
  }),
});

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

  it.effect("lets refine turn a cause into a domain error", () =>
    Effect.gen(function* () {
      const conflict = new UserAlreadyExists({ email: "ada@example.com" });

      const refined = yield* calls
        .run("insert", Effect.fail(authorizationError), () => conflict)
        .pipe(Effect.flip);

      assert.strictEqual(refined, conflict);

      const unrefined = yield* calls
        .run("insert", Effect.fail(authorizationError), () => undefined)
        .pipe(Effect.flip);

      assert.instanceOf(unrefined, UserRepositoryError);
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

  it.effect("failAs reports a later step, such as decoding, the same way", () =>
    Effect.gen(function* () {
      const failure = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ email: Schema.String }),
      )({}).pipe(calls.failAs("insert"), Effect.flip);

      assert.instanceOf(failure, UserRepositoryError);
      assert.strictEqual(failure.operation, "insert");

      assert.deepStrictEqual(failure.diagnostics, {
        reason: "SchemaError",
        validationPaths: ["email"],
      });
    }),
  );
});
