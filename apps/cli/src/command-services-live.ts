import { Layer } from "effect";

import { AppConfig } from "@node-effect/config";
import {
  DatabaseLive,
  PgClientLive,
  UserRepositoryLive,
} from "@node-effect/database";

// The adapters behind the application ports the commands use, and the
// configuration PgClientLive reads. A command builds them when it runs and
// closes the pool when it ends. Add the adapters a new command's ports need
// here.
const CommandServicesLive = UserRepositoryLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(PgClientLive),
  Layer.provide(AppConfig.layer),
);

export { CommandServicesLive };
