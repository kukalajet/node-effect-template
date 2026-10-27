import { join } from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import { Cause, Effect, Layer, Logger } from "effect";
import { SqlError } from "effect/sql";

import { redactCause } from "@node-effect/application";
import { AppConfig } from "@node-effect/config";

import { diagnosticsFromCause } from "./error-diagnostics.ts";
import { Database, DatabaseLive, PgClientLive } from "./postgres.ts";

const migrationsFolder = join(import.meta.dirname, "../../../drizzle");

// drizzle-kit's default journal location; drizzle.config.ts keeps it, so
// `drizzle-kit migrate` and this program each skip what the other applied.
const drizzleKitMigrationsSchema = "drizzle";
const migrationsTable = "__drizzle_migrations";

// Applies every migration in drizzle/ that the journal does not list yet, in
// one transaction.
const migrateDatabase = (migrationsSchema = drizzleKitMigrationsSchema) =>
  Database.use((database) =>
    migrate(database, { migrationsFolder, migrationsSchema, migrationsTable }),
  );

const isDatabaseFailure = (
  error: unknown,
): error is EffectDrizzleQueryError | SqlError.SqlError =>
  error instanceof EffectDrizzleQueryError || SqlError.isSqlError(error);

const databaseFailureReport = (
  error: EffectDrizzleQueryError | SqlError.SqlError,
) => ({ _tag: error._tag, diagnostics: diagnosticsFromCause(error) });

// Database causes can carry SQL and stored values, so they are reported by
// their safe diagnostics, also when one arrives as a defect: a migration whose
// connection drops fails its statement and then dies on ROLLBACK. Other
// failures, such as missing configuration, keep their details.
const reportMigrationFailure = (cause: Cause.Cause<unknown>) => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void;

  return Effect.logError(
    "Database migration failed",
    redactCause(cause, isDatabaseFailure, databaseFailureReport),
  );
};

const MigrationDatabaseLive = DatabaseLive.pipe(
  Layer.provide(PgClientLive),
  Layer.provide(AppConfig.layer),
);

const migration = migrateDatabase().pipe(
  Effect.andThen(Effect.logInfo("Database migrations applied")),
  Effect.provide(MigrationDatabaseLive),
  Effect.tapCause(reportMigrationFailure),
  Effect.provide(Logger.layer([Logger.consoleJson])),
);

if (import.meta.main) {
  NodeRuntime.runMain(migration, { disableErrorReporting: true });
}

export { migrateDatabase, reportMigrationFailure };
