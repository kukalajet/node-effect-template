import { CliConfig, Command, GlobalFlag } from "effect/cli";

import { usersCommand } from "./users/commands.ts";

// Every command the CLI runs, by group. Add a feature's group here;
// CommandServicesLive must provide the adapters behind its ports.
const cli = Command.make("node-effect").pipe(
  Command.withDescription("Manage node-effect from the command line"),
  Command.withSubcommands([usersCommand]),
);

// --help and --version, and none of effect/cli's other global flags:
// LOG_LEVEL sets the level, as for every Node entry point, where --log-level
// would set it inside the command only, never for its failure report; no shell
// has a node-effect command for --completions to complete; and a command takes
// its input as flags and arguments, never through --wizard's prompts.
const CliConfigLive = CliConfig.layer({
  builtIns: [GlobalFlag.Help, GlobalFlag.Version],
});

export { cli, CliConfigLive };
