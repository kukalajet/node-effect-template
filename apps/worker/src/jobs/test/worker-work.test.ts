import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Logger } from "effect";
import { TestClock } from "effect/testing";

import { UserRepository, UserRepositoryError } from "@node-effect/application";

import { pollWorkerWork, processWorkerWorkPass } from "../worker-work.ts";

const repositoryFailure = new UserRepositoryError({
  operation: "list",
  cause: new Error("Unreachable PostgreSQL"),
  diagnostics: { reason: "ConnectionError", code: "ECONNREFUSED" },
});

const listingWith = (list: UserRepository["Service"]["list"]) =>
  Layer.mock(UserRepository, { list });

const timings = { intervalMs: 1000, passTimeoutMs: 60_000 };

describe("pollWorkerWork", () => {
  it.effect("starts at once, never overlaps, and waits after each pass", () =>
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      let calls = 0;

      const repository = listingWith(() =>
        Effect.gen(function* () {
          calls += 1;

          if (calls === 1) {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(releaseFirst);
          } else {
            yield* Deferred.succeed(secondStarted, undefined);
          }

          return [];
        }),
      );

      const worker = yield* pollWorkerWork(timings).pipe(
        Effect.provide(repository),
        Effect.forkScoped,
      );

      yield* Deferred.await(firstStarted);
      assert.strictEqual(calls, 1);
      yield* TestClock.adjust(5000);
      assert.strictEqual(calls, 1, "a slow pass must not overlap or queue");

      yield* Deferred.succeed(releaseFirst, undefined);
      yield* TestClock.adjust(999);
      assert.strictEqual(calls, 1, "the interval starts after the pass ends");
      yield* TestClock.adjust(1);
      yield* Deferred.await(secondStarted);
      assert.strictEqual(calls, 2);

      yield* Fiber.interrupt(worker);
      yield* TestClock.adjust(5000);
      assert.strictEqual(calls, 2, "interruption stops future passes");
    }).pipe(Effect.provide(Logger.layer([]))),
  );

  it.effect("fails with the first failed pass and polls no more", () =>
    Effect.gen(function* () {
      let calls = 0;

      const repository = listingWith(() =>
        Effect.suspend(() => {
          calls += 1;

          return Effect.fail(repositoryFailure);
        }),
      );

      const exit = yield* pollWorkerWork(timings).pipe(
        Effect.provide(repository),
        Effect.exit,
      );

      yield* TestClock.adjust(5000);

      assert(Exit.isFailure(exit));
      assert.strictEqual(Cause.squash(exit.cause), repositoryFailure);
      assert.strictEqual(calls, 1);
    }),
  );

  it.effect("ends with the original defect", () =>
    Effect.gen(function* () {
      const defect = new Error("UNEXPECTED_FAILURE");

      const exit = yield* pollWorkerWork(timings).pipe(
        Effect.provide(listingWith(() => Effect.die(defect))),
        Effect.exit,
      );

      assert(Exit.isFailure(exit));
      assert.strictEqual(Cause.squash(exit.cause), defect);
    }),
  );

  it.effect("interrupting an active pass runs its cleanup", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let calls = 0;
      let cleanedUp = false;

      const repository = listingWith(() =>
        Effect.gen(function* () {
          calls += 1;
          yield* Deferred.succeed(started, undefined);

          return yield* Effect.never;
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              cleanedUp = true;
            }),
          ),
        ),
      );

      const worker = yield* pollWorkerWork(timings).pipe(
        Effect.provide(repository),
        Effect.forkScoped,
      );

      yield* Deferred.await(started);
      yield* Fiber.interrupt(worker);
      const exit = yield* Fiber.await(worker);
      yield* TestClock.adjust(5000);

      assert(Exit.isFailure(exit));
      assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
      assert.isTrue(cleanedUp);
      assert.strictEqual(calls, 1);
    }),
  );

  it.effect(
    "fails when a pass outlives the pass timeout, interrupting it",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        let cleanedUp = false;

        const repository = listingWith(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);

            return yield* Effect.never;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                cleanedUp = true;
              }),
            ),
          ),
        );

        const worker = yield* pollWorkerWork(timings).pipe(
          Effect.provide(repository),
          Effect.forkScoped,
        );

        yield* Deferred.await(started);
        yield* TestClock.adjust(timings.passTimeoutMs - 1);

        assert.isUndefined(
          worker.pollUnsafe(),
          "a pass may run up to the limit",
        );

        yield* TestClock.adjust(1);
        const exit = yield* Fiber.await(worker);

        assert(Exit.isFailure(exit));
        const error = Cause.squash(exit.cause);
        assert(Cause.isTimeoutError(error));
        assert.match(error.message, /sample-users/);
        assert.isTrue(cleanedUp, "the timed-out pass is interrupted");
      }),
  );

  it.effect("limits each pass, not the loop", () =>
    Effect.gen(function* () {
      let calls = 0;

      const repository = listingWith(() =>
        Effect.sync(() => {
          calls += 1;

          return [];
        }),
      );

      const worker = yield* pollWorkerWork({
        intervalMs: 1000,
        passTimeoutMs: 1500,
      }).pipe(Effect.provide(repository), Effect.forkScoped);

      yield* TestClock.adjust(10_000);

      assert.isUndefined(worker.pollUnsafe());
      assert.strictEqual(calls, 11);
    }).pipe(Effect.provide(Logger.layer([]))),
  );
});

describe("processWorkerWorkPass", () => {
  it.effect("runs every job once", () =>
    Effect.gen(function* () {
      let calls = 0;

      yield* processWorkerWorkPass(timings.passTimeoutMs).pipe(
        Effect.provide(
          listingWith(() =>
            Effect.sync(() => {
              calls += 1;

              return [];
            }),
          ),
        ),
        Effect.provide(Logger.layer([])),
      );

      assert.strictEqual(calls, 1);
    }),
  );

  it.effect("fails with the job's error", () =>
    Effect.gen(function* () {
      const error = yield* processWorkerWorkPass(timings.passTimeoutMs).pipe(
        Effect.provide(listingWith(() => Effect.fail(repositoryFailure))),
        Effect.flip,
      );

      assert.strictEqual(error, repositoryFailure);
    }),
  );

  it.effect("fails with a TimeoutError when a job outlives the timeout", () =>
    Effect.gen(function* () {
      const pass = yield* processWorkerWorkPass(timings.passTimeoutMs).pipe(
        Effect.provide(listingWith(() => Effect.never)),
        Effect.flip,
        Effect.forkScoped,
      );

      yield* TestClock.adjust(timings.passTimeoutMs);
      const error = yield* Fiber.join(pass);

      assert(Cause.isTimeoutError(error));
      assert.match(error.message, /sample-users/);
    }),
  );
});
