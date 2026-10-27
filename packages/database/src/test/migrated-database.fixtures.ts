import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Config, Effect, Layer, Redacted } from "effect";
import { SqlClient } from "effect/sql";

import { AppConfig } from "@node-effect/config";

import { type Database, DatabaseLive, PgClientLive } from "../postgres.ts";

const migrationsRoot = join(import.meta.dirname, "../../../../drizzle");

// Every statement in drizzle/, in the order drizzle-kit applies them: by
// migration folder, whose names start with a timestamp.
const readMigrationStatements = () =>
  readdirSync(migrationsRoot)
    .sort()
    .map((folder) => join(migrationsRoot, folder, "migration.sql"))
    .filter((path) => existsSync(path))
    .flatMap((path) =>
      readFileSync(path, "utf8").split("--> statement-breakpoint"),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const migrationStatements = readMigrationStatements();

// Connections opened with the returned URL resolve unqualified names in
// `schemaName` only.
const withSearchPath = (databaseUrl: string, schemaName: string) => {
  const url = new URL(databaseUrl);
  const options = url.searchParams.get("options") ?? "";

  url.searchParams.set(
    "options",
    `${options} -c search_path=${schemaName}`.trim(),
  );

  return url.toString();
};

// Creates the schema with `statements` applied, and drops it with everything
// in it when the layer is released.
const testSchema = (schemaName: string, statements: ReadonlyArray<string>) =>
  Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* sql.unsafe(`create schema "${schemaName}"`);

        for (const statement of statements) {
          yield* sql.unsafe(statement);
        }

        return sql;
      }),
      (sql) =>
        sql.unsafe(`drop schema "${schemaName}" cascade`).pipe(Effect.orDie),
    ),
  );

// A schema of its own for one test. Provides `Database` and the `SqlClient`
// it runs on, so a test can arrange and inspect rows directly.
const testDatabase = (statements: ReadonlyArray<string>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const databaseUrl = yield* Config.String("DATABASE_URL");
      const schemaName = `test_${crypto.randomUUID().replaceAll("-", "")}`;

      const config = Layer.succeed(
        AppConfig,
        AppConfig.of({
          databaseUrl: Redacted.make(withSearchPath(databaseUrl, schemaName)),
          apiHost: "127.0.0.1",
          apiPort: 8000,
          workerPollIntervalMs: 5000,
        }),
      );

      return Layer.mergeAll(
        DatabaseLive,
        testSchema(schemaName, statements),
      ).pipe(Layer.provideMerge(PgClientLive), Layer.provide(config));
    }),
  );

// Runs an effect on a fresh schema with every migration applied, providing
// `adapter` built on it.
const withMigratedDatabase = <Provided, LayerError>(
  adapter: Layer.Layer<Provided, LayerError, Database>,
) =>
  Effect.provide(
    adapter.pipe(Layer.provideMerge(testDatabase(migrationStatements))),
  );

// Runs an effect on a fresh schema with nothing in it.
const withEmptyDatabase = Effect.provide(testDatabase([]));

export { withEmptyDatabase, withMigratedDatabase };
