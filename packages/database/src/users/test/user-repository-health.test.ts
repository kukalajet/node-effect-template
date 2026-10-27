import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import { UserRepository, UserRepositoryError } from "@node-effect/application";

import { DatabaseLive } from "../../postgres.ts";
import { pgClientLayer, stalledConnection } from "../../test/pg-client.ts";
import { UserRepositoryLive } from "../user-repository-live.ts";

// A database that accepts the query and never answers it. Readiness must give
// up on its own, so this check cannot run against a responsive PostgreSQL.
const stalledRepository = UserRepositoryLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(pgClientLayer(Effect.succeed(stalledConnection))),
);

describe("UserRepositoryLive.health", () => {
  it.effect("stops waiting for a stalled query after five seconds", () =>
    Effect.gen(function* () {
      const repository = yield* UserRepository;
      const fiber = yield* repository.health.pipe(
        Effect.flip,
        Effect.forkScoped,
      );

      yield* TestClock.adjust("5 seconds");
      const failure = yield* Fiber.join(fiber);

      assert.instanceOf(failure, UserRepositoryError);
      assert.strictEqual(failure.operation, "health");
      assert.deepStrictEqual(failure.diagnostics, { reason: "TimeoutError" });
    }).pipe(Effect.provide(stalledRepository)),
  );
});
