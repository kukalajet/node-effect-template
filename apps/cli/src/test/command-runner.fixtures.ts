import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Stdio,
  Terminal,
} from "effect";
import { CliOutput, Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";

import { CliConfigLive } from "../commands.ts";

// What effect/cli needs to run a command that reads no file, starts no process
// and prompts for nothing, as none here does, the CLI's global flags, and a
// formatter without colors, so that what a command prints does not depend on
// the terminal that runs the tests.
const CliEnvironmentTest = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("A command read terminal input"),
      readLine: Effect.die("A command read terminal input"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("A command started a process")),
  ),
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  CliConfigLive,
);

// Runs `command` with `args` as main.ts runs the CLI's root command, and
// returns how it ended and what it printed: one entry per line a command
// printed, or per block of help or errors effect/cli printed. The command's
// ports are the caller's to provide.
const runCommand = <Name extends string, Input, ContextInput, E, R>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  args: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const testConsole = yield* TestConsole.make;

    const exit = yield* Command.runWith(command, { version: "0.0.0" })(
      args,
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          CliEnvironmentTest,
          Layer.succeed(Console.Console, testConsole),
        ),
      ),
      Effect.exit,
    );

    const output = yield* testConsole.logLines;
    const errors = yield* testConsole.errorLines;

    return { exit, output: output.map(String), errors: errors.map(String) };
  });

export { runCommand };
