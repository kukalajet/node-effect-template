import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer } from "effect";

import { AppConfig } from "@node-effect/config";

const PgClientLive = PgClient.layerFrom(
  Effect.gen(function* () {
    const config = yield* AppConfig;

    // The pool opens connections on demand, so liveness does not depend on the
    // database being available during application startup.
    return yield* PgClient.make({
      url: config.databaseUrl,
      applicationName: "node-effect-template",
      connectTimeout: "5 seconds",
      maxConnections: 10,
      minConnections: 0,
    });
  }),
);

const databaseEffect = PgDrizzle.makeWithDefaults();

class Database extends Context.Service<
  Database,
  Effect.Success<typeof databaseEffect>
>()("@node-effect/database/Database") {}

type DatabaseTransaction = Parameters<
  Parameters<Database["Service"]["transaction"]>[0]
>[0];

const DatabaseLive = Layer.effect(Database, databaseEffect);

export { Database, DatabaseLive, type DatabaseTransaction, PgClientLive };
