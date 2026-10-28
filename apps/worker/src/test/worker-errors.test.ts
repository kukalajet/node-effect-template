import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Logger,
  References,
  Runtime,
} from "effect";

import { UserRepository, UserRepositoryError } from "@node-effect/application";

import { pollWorkerWork, processWorkerWorkPass } from "../jobs/worker-work.ts";
import { reportWorkerFailure } from "../worker-errors.ts";

const sentinels = /SECRET_SENTINEL|SQL_SENTINEL|PARAM_SENTINEL/;

type WorkerRun = {
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly code: number;
  readonly lines: ReadonlyArray<string>;
};

// Runs `program` the way runWorker does, through a runMain whose teardown
// reports the exit code instead of exiting the test process.
const runWorker = <E>(program: Effect.Effect<void, E>) =>
  new Promise<WorkerRun>((resolve) => {
    const lines: Array<string> = [];

    const logger = Logger.map(Logger.formatJson, (line) => {
      lines.push(line);
    });

    const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
      fiber.addObserver((exit) => {
        teardown(exit, (code) => resolve({ exit, code, lines }));
      });
    });

    runMain(
      Effect.withFiber((fiber) => {
        // Captures the runtime's own reporting too, without changing the
        // global loggers, and the sample job's Debug line.
        fiber.setContext(
          fiber.context.pipe(
            Context.add(Logger.CurrentLoggers, new Set([logger])),
            Context.add(References.MinimumLogLevel, "Debug"),
          ),
        );

        return program.pipe(Effect.tapCause(reportWorkerFailure));
      }),
      { disableErrorReporting: true },
    );
  });

const repositoryFailure = () =>
  new UserRepositoryError({
    operation: "list",
    cause: Object.assign(new Error("SECRET_SENTINEL"), {
      query: "select SQL_SENTINEL",
      params: ["PARAM_SENTINEL"],
    }),
    diagnostics: { reason: "AuthorizationError", code: "42501" },
  });

const listingWith = (list: UserRepository["Service"]["list"]) =>
  Layer.mock(UserRepository, { list });

const unexpectedError = new Error("UNEXPECTED_FAILURE");

describe("worker failure reporting", () => {
  it("logs a repository failure once with safe diagnostics and exits 1", async () => {
    const error = repositoryFailure();
    let finalized = false;

    const result = await runWorker(
      processWorkerWorkPass(60_000).pipe(
        Effect.provide(listingWith(() => Effect.fail(error))),
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      ),
    );

    assert.strictEqual(result.code, 1);
    assert(Exit.isFailure(result.exit));
    assert.strictEqual(Cause.squash(result.exit.cause), error);
    assert.isTrue(finalized);
    assert.lengthOf(result.lines, 1);
    const line = result.lines.join("");
    const log = JSON.parse(line);
    assert.strictEqual(log.level, "ERROR");
    assert.strictEqual(log.message, "Worker failed");
    assert.deepStrictEqual(log.annotations, { service: "worker" });
    assert.match(line, /UserRepositoryError/);
    assert.match(line, /AuthorizationError/);
    assert.match(line, /42501/);
    assert.notMatch(line, sentinels);
  });

  it("exits 1 as soon as one polling loop fails", async () => {
    const result = await runWorker(
      pollWorkerWork({ intervalMs: 60_000, passTimeoutMs: 60_000 }).pipe(
        Effect.provide(listingWith(() => Effect.fail(repositoryFailure()))),
      ),
    );

    assert.strictEqual(result.code, 1);
    assert.lengthOf(result.lines, 1);
    assert.match(result.lines.join(""), /Worker failed/);
    assert.notMatch(result.lines.join(""), sentinels);
  });

  it("logs a pass that outlives its timeout by its job and exits 1", async () => {
    let interrupted = false;

    const result = await runWorker(
      processWorkerWorkPass(10).pipe(
        Effect.provide(
          listingWith(() =>
            Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
          ),
        ),
      ),
    );

    assert.strictEqual(result.code, 1);
    assert.isTrue(interrupted);
    assert.lengthOf(result.lines, 1);
    const line = result.lines.join("");
    assert.match(line, /Worker failed/);
    assert.match(line, /TimeoutError/);
    assert.match(line, /sample-users ran longer than its 10 ms pass timeout/);
  });

  for (const testCase of [
    {
      name: "startup failure",
      program: processWorkerWorkPass(60_000).pipe(
        Effect.provide(
          Layer.effect(UserRepository, Effect.fail(unexpectedError)),
        ),
      ),
    },
    { name: "defect", program: Effect.die(unexpectedError) },
  ]) {
    it(`keeps the details of an unexpected ${testCase.name}`, async () => {
      const result = await runWorker(testCase.program);

      assert.strictEqual(result.code, 1);
      assert(Exit.isFailure(result.exit));
      assert.strictEqual(Cause.squash(result.exit.cause), unexpectedError);
      assert.lengthOf(result.lines, 1);
      assert.match(result.lines.join(""), /UNEXPECTED_FAILURE/);
    });
  }

  it("reports a cleanup defect alongside a safe repository failure", async () => {
    const error = repositoryFailure();
    const cleanupError = new Error("CLEANUP_FAILURE");

    const result = await runWorker(
      processWorkerWorkPass(60_000).pipe(
        Effect.provide(
          Layer.effect(
            UserRepository,
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.die(cleanupError));

              return UserRepository.of({
                health: Effect.void,
                insert: () => Effect.fail(error),
                findById: () => Effect.fail(error),
                list: () => Effect.fail(error),
              });
            }),
          ),
        ),
      ),
    );

    assert.strictEqual(result.code, 1);
    assert(Exit.isFailure(result.exit));
    assert.lengthOf(result.exit.cause.reasons, 2);
    assert.strictEqual(Cause.squash(result.exit.cause), error);
    assert.lengthOf(result.lines, 1);
    const output = result.lines.join("");
    assert.match(output, /AuthorizationError/);
    assert.match(output, /CLEANUP_FAILURE/);
    assert.notMatch(output, sentinels);
  });

  it("treats interruption as a shutdown: no error log, exit 130", async () => {
    let finalized = false;

    const result = await runWorker(
      Effect.interrupt.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      ),
    );

    assert.strictEqual(result.code, 130);
    assert(Exit.isFailure(result.exit));
    assert.isTrue(Cause.hasInterruptsOnly(result.exit.cause));
    assert.isTrue(finalized);
    assert.deepStrictEqual(result.lines, []);
  });

  it("exits 0 after a successful pass, logging only the job's output", async () => {
    const result = await runWorker(
      processWorkerWorkPass(60_000).pipe(
        Effect.provide(listingWith(() => Effect.succeed([]))),
      ),
    );

    assert.strictEqual(result.code, 0);
    assert.isTrue(Exit.isSuccess(result.exit));
    assert.lengthOf(result.lines, 1);
    assert.match(result.lines.join(""), /Worker user sample loaded/);
  });
});
