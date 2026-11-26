import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Logger, Schema } from "effect";
import { Command, Flag } from "effect/cli";

import { persistenceFailureFields } from "@node-effect/application";

import { cliTeardown, reportCliFailure, userError } from "../cli-errors.ts";

import { runCommand } from "./command-runner.fixtures.ts";

// A persistence failure of the test's own, so the test does not depend on the
// users example.
class ProbeFailure extends Schema.TaggedError<ProbeFailure>()(
  "ProbeFailure",
  persistenceFailureFields(["read", "write"]),
) {}

const sentinels = /SECRET_SENTINEL|SQL_SENTINEL|PARAM_SENTINEL/;

const repositoryFailure = new ProbeFailure({
  operation: "read",
  cause: Object.assign(new Error("SECRET_SENTINEL"), {
    query: "select SQL_SENTINEL",
    params: ["PARAM_SENTINEL"],
  }),
  diagnostics: { reason: "AuthorizationError", code: "42501" },
});

// A command that ends as `handler` does, with a flag to give invalid input to.
const probeCommand = (handler: Effect.Effect<void, unknown>) =>
  Command.make(
    "probe",
    { count: Flag.Int("count").pipe(Flag.withDefault(1)) },
    () => handler,
  );

// The code main.ts exits with when its program ends as `exit` does.
const exitCodeOf = (exit: Exit.Exit<unknown, unknown>) => {
  let code: number | undefined;

  cliTeardown(exit, (exitCode) => {
    code = exitCode;
  });

  return code;
};

// Logs `cause` with the CLI's failure reporter and returns the JSON lines.
const reportedLines = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const lines: Array<string> = [];

    const logger = Logger.map(Logger.formatJson, (line) => {
      lines.push(line);
    });

    yield* reportCliFailure(cause).pipe(Effect.provide(Logger.layer([logger])));

    return lines;
  });

// Runs `probe <args>` and reports how it ended, as main.ts does, returning
// what effect/cli printed and the JSON lines the reporter logged.
const runReported = (
  handler: Effect.Effect<void, unknown>,
  ...args: ReadonlyArray<string>
) =>
  Effect.gen(function* () {
    const result = yield* runCommand(probeCommand(handler), args);

    const lines = Exit.isFailure(result.exit)
      ? yield* reportedLines(result.exit.cause)
      : [];

    return { ...result, lines };
  });

describe("CLI failure reporting", () => {
  it.effect("logs a persistence failure once, with safe diagnostics", () =>
    Effect.gen(function* () {
      const { exit, lines } = yield* runReported(
        Effect.fail(repositoryFailure),
      );

      assert(Exit.isFailure(exit));
      assert.strictEqual(Cause.squash(exit.cause), repositoryFailure);
      assert.strictEqual(exitCodeOf(exit), 1);
      assert.lengthOf(lines, 1);
      const line = lines.join("");
      const log = JSON.parse(line);
      assert.strictEqual(log.level, "ERROR");
      assert.strictEqual(log.message, "CLI failed");
      assert.deepStrictEqual(log.annotations, { service: "cli" });
      assert.match(line, /ProbeFailure/);
      assert.match(line, /AuthorizationError/);
      assert.match(line, /42501/);
      assert.notMatch(line, sentinels);
    }),
  );

  it.effect("keeps the details of an unexpected defect", () =>
    Effect.gen(function* () {
      const { lines } = yield* runReported(
        Effect.die(new Error("UNEXPECTED_FAILURE")),
      );

      assert.lengthOf(lines, 1);
      assert.match(lines.join(""), /UNEXPECTED_FAILURE/);
    }),
  );

  it.effect("logs nothing for invalid input, which effect/cli shows", () =>
    Effect.gen(function* () {
      const { exit, errors, lines } = yield* runReported(
        Effect.void,
        "--count",
        "ten",
      );

      assert.strictEqual(exitCodeOf(exit), 1);
      assert.include(errors.join("\n"), "Invalid value for flag --count");
      assert.deepStrictEqual(lines, []);
    }),
  );

  it.effect("logs nothing for a user error, which effect/cli shows", () =>
    Effect.gen(function* () {
      const { exit, errors, lines } = yield* runReported(
        userError("Nothing to do")(new Error("SECRET_SENTINEL")),
      );

      assert.strictEqual(exitCodeOf(exit), 1);
      assert.include(errors.join("\n"), "Nothing to do");
      assert.notMatch(errors.join("\n"), sentinels);
      assert.deepStrictEqual(lines, []);
    }),
  );

  it.effect("logs nothing for a group run without a command", () =>
    Effect.gen(function* () {
      const group = Command.make("group").pipe(
        Command.withSubcommands([probeCommand(Effect.void)]),
      );

      const { exit, output } = yield* runCommand(group, []);

      assert(Exit.isFailure(exit));
      assert.include(output.join("\n"), "probe");
      // effect/cli printed the group's help, as asked, so the run exits 0.
      assert.strictEqual(exitCodeOf(exit), 0);
      assert.deepStrictEqual(yield* reportedLines(exit.cause), []);
    }),
  );

  it.effect("logs a cleanup defect, not the request for help it stopped", () =>
    Effect.gen(function* () {
      // The services' cleanup dies, which turns the group's request for help
      // into a defect too: effect/cli prints no help, both defects reach the
      // reporter, and the run fails, though the request for help, whose code
      // is 0, comes first in the cause.
      const group = Command.make("group").pipe(
        Command.withSubcommands([probeCommand(Effect.void)]),
        Command.provide(
          Layer.effectDiscard(
            Effect.addFinalizer(() => Effect.die(new Error("CLEANUP_FAILURE"))),
          ),
        ),
      );

      const { exit, output } = yield* runCommand(group, []);

      assert(Exit.isFailure(exit));
      assert(exit.cause.reasons.every(Cause.isDieReason));
      assert.deepStrictEqual(output, []);
      assert.strictEqual(exitCodeOf(exit), 1);
      const lines = yield* reportedLines(exit.cause);
      assert.lengthOf(lines, 1);
      assert.match(lines.join(""), /CLEANUP_FAILURE/);
      assert.notMatch(lines.join(""), /ShowHelp|Help requested/);
    }),
  );

  it.effect("logs nothing for an interruption", () =>
    Effect.gen(function* () {
      const { exit, lines } = yield* runReported(Effect.interrupt);

      assert.strictEqual(exitCodeOf(exit), 130);
      assert.deepStrictEqual(lines, []);
    }),
  );
});
