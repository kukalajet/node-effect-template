import { assert, describe, it } from "@effect/vitest";
import { Console, ConfigProvider, Effect, Layer } from "effect";
import { TestConsole } from "effect/testing";

import { UserRepositoryError } from "@node-effect/application";
import { LoggingLive } from "@node-effect/config";

import { reportApiFailure } from "../api-failure.ts";

const sentinels = /SECRET_SENTINEL|SQL_SENTINEL|PARAM_SENTINEL/;

const repositoryFailure = new UserRepositoryError({
  operation: "list",
  cause: Object.assign(new Error("SECRET_SENTINEL"), {
    query: "select SQL_SENTINEL",
    params: ["PARAM_SENTINEL"],
  }),
  diagnostics: { reason: "ConnectionError", code: "ECONNREFUSED" },
});

// Runs `program` with the API's reporter, logging as main.ts does to a
// TestConsole, and returns the JSON lines.
const reportedLines = <E>(program: Effect.Effect<void, E>) =>
  Effect.gen(function* () {
    const testConsole = yield* TestConsole.make;

    yield* program.pipe(
      Effect.tapCause(reportApiFailure),
      Effect.exit,
      Effect.provide(
        Layer.mergeAll(
          LoggingLive.pipe(
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            ),
          ),
          Layer.succeed(Console.Console, testConsole),
        ),
      ),
    );

    const lines = yield* testConsole.logLines;

    return lines.map((line) => JSON.parse(String(line)));
  });

describe("reportApiFailure", () => {
  it.effect("logs a persistence failure once, as its safe report", () =>
    Effect.gen(function* () {
      for (const program of [
        Effect.fail(repositoryFailure),
        Effect.die(repositoryFailure),
      ]) {
        const lines = yield* reportedLines(program);

        assert.deepStrictEqual(
          lines.map((line) => [line.message, line.level]),
          [["API failed", "ERROR"]],
        );

        const output = JSON.stringify(lines);

        assert.include(output, "UserRepositoryError");
        assert.include(output, "ECONNREFUSED");
        assert.notMatch(output, sentinels);
      }
    }),
  );

  it.effect("keeps an unexpected failure's details", () =>
    Effect.gen(function* () {
      const lines = yield* reportedLines(
        Effect.die(new Error("UNEXPECTED_DEFECT")),
      );

      assert.lengthOf(lines, 1);
      assert.include(lines[0]?.cause, "UNEXPECTED_DEFECT");
    }),
  );

  it.effect("logs nothing when interrupted, a normal shutdown", () =>
    Effect.gen(function* () {
      const lines = yield* reportedLines(Effect.interrupt);

      assert.deepStrictEqual(lines, []);
    }),
  );
});
