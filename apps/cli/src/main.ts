import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";

import { StderrLoggingLive } from "@node-effect/config";

import packageJson from "../package.json" with { type: "json" };

import { reportCliFailure } from "./cli-errors.ts";
import { CommandServicesLive } from "./command-services-live.ts";
import { cli, CliConfigLive } from "./commands.ts";

// A command builds CommandServicesLive when it runs, after effect/cli has
// parsed its input, so --help, --version and invalid input need neither
// configuration nor a database. A group run without a command, which prints
// its help, builds them first, though it opens no connection.
//
// A command prints its result on standard output, where effect/cli prints help
// and the version too. Error messages go to standard error, and so do
// StderrLoggingLive's lines. reportCliFailure logs a failure once, as JSON. runMain's own reporting stays
// off: it would log the raw cause again, as text, outside StderrLoggingLive.
// test/main.test.ts checks all of this by running this file.
const main = cli.pipe(
  Command.provide(CommandServicesLive),
  Command.run({ version: packageJson.version }),
  Effect.provide(Layer.mergeAll(NodeServices.layer, CliConfigLive)),
  Effect.tapCause(reportCliFailure),
  Effect.provide(StderrLoggingLive),
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
