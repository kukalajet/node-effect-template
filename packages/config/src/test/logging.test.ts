import { assert, describe, it } from "@effect/vitest";
import {
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Logger,
  References,
} from "effect";
import { TestConsole } from "effect/testing";

import { LoggingLive, StderrLoggingLive } from "@node-effect/config";

// LoggingLive reading `env` instead of the process environment.
const loggingLiveWith = (env: Record<string, string>) =>
  LoggingLive.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
  );

// StderrLoggingLive reading `env`.
const stderrLoggingLiveWith = (env: Record<string, string>) =>
  StderrLoggingLive.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
  );

// ...writing to a TestConsole.
const loggingWith = (env: Record<string, string>) =>
  Layer.mergeAll(loggingLiveWith(env), TestConsole.layer);

const loggedLines = TestConsole.logLines.pipe(
  Effect.map((lines) => lines.map((line) => JSON.parse(String(line)))),
);

describe("LoggingLive", () => {
  it.effect("logs Info and above as JSON by default", () =>
    Effect.gen(function* () {
      yield* Effect.logDebug("hidden");

      yield* Effect.logInfo("shown").pipe(
        Effect.annotateLogs({ key: "value" }),
      );

      const lines = yield* loggedLines;

      assert.lengthOf(lines, 1);
      assert.strictEqual(lines[0].message, "shown");
      assert.strictEqual(lines[0].level, "INFO");
      assert.deepStrictEqual(lines[0].annotations, { key: "value" });

      // Logger.consoleJson's fields, in its order, and no span ids.
      assert.deepStrictEqual(Object.keys(lines[0]), [
        "message",
        "level",
        "timestamp",
        "annotations",
        "spans",
        "fiberId",
      ]);
    }).pipe(Effect.provide(loggingWith({}))),
  );

  it.effect("treats an empty LOG_LEVEL as unset", () =>
    Effect.gen(function* () {
      yield* Effect.logDebug("hidden");
      yield* Effect.logInfo("shown");
      const lines = yield* loggedLines;

      assert.deepStrictEqual(
        lines.map((line) => line.message),
        ["shown"],
      );
    }).pipe(Effect.provide(loggingWith({ LOG_LEVEL: "" }))),
  );

  it.effect("logs Debug when LOG_LEVEL is Debug", () =>
    Effect.gen(function* () {
      yield* Effect.logDebug("shown");
      const lines = yield* loggedLines;

      assert.lengthOf(lines, 1);
      assert.strictEqual(lines[0].level, "DEBUG");
    }).pipe(Effect.provide(loggingWith({ LOG_LEVEL: "Debug" }))),
  );

  it.effect("adds the current span's trace and span ids", () =>
    Effect.gen(function* () {
      const span = yield* Effect.gen(function* () {
        yield* Effect.logInfo("inside");

        return yield* Effect.currentSpan;
      }).pipe(Effect.withSpan("operation"));

      const lines = yield* loggedLines;

      assert.strictEqual(lines[0].traceId, span.traceId);
      assert.strictEqual(lines[0].spanId, span.spanId);
    }).pipe(Effect.provide(loggingWith({}))),
  );

  it.effect("keeps tracerLogger and drops the default text logger", () =>
    Effect.gen(function* () {
      const loggers = yield* References.CurrentLoggers;

      assert.isTrue(loggers.has(Logger.tracerLogger));
      assert.isFalse(loggers.has(Logger.defaultLogger));
      assert.strictEqual(loggers.size, 2);
    }).pipe(Effect.provide(loggingWith({}))),
  );

  it.effect("reports an invalid LOG_LEVEL and fails", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(loggingLiveWith({ LOG_LEVEL: "debug" })),
      );

      const lines = yield* loggedLines;

      assert.isTrue(Exit.isFailure(exit));
      assert.lengthOf(lines, 1);
      assert.strictEqual(lines[0].message, "Invalid logging configuration");
      assert.strictEqual(lines[0].level, "ERROR");
      assert.include(lines[0].cause, "LOG_LEVEL");
      assert.include(lines[0].cause, '"Debug"');
    }).pipe(Effect.scoped, Effect.provide(TestConsole.layer)),
  );
});

describe("StderrLoggingLive", () => {
  it.effect("logs LoggingLive's lines on standard error instead", () =>
    Effect.gen(function* () {
      yield* Effect.logDebug("shown");
      yield* Effect.logTrace("hidden");
      const errorLines = yield* TestConsole.errorLines;
      const lines = errorLines.map((line) => JSON.parse(String(line)));

      assert.deepStrictEqual(yield* TestConsole.logLines, []);

      assert.deepStrictEqual(
        lines.map((line) => [line.message, line.level]),
        [["shown", "DEBUG"]],
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          stderrLoggingLiveWith({ LOG_LEVEL: "Debug" }),
          TestConsole.layer,
        ),
      ),
    ),
  );

  it.effect("reports an invalid LOG_LEVEL on standard error and fails", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(stderrLoggingLiveWith({ LOG_LEVEL: "debug" })),
      );

      const errorLines = yield* TestConsole.errorLines;

      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(yield* TestConsole.logLines, []);
      assert.lengthOf(errorLines, 1);

      assert.strictEqual(
        JSON.parse(String(errorLines[0])).message,
        "Invalid logging configuration",
      );
    }).pipe(Effect.scoped, Effect.provide(TestConsole.layer)),
  );
});
