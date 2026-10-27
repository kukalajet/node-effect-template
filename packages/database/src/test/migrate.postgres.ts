import { readdirSync } from "node:fs";
import { join } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { migrateDatabase } from "../migrate.ts";

import { withEmptyDatabase } from "./migrated-database.fixtures.ts";

const migrationNames = readdirSync(
  join(import.meta.dirname, "../../../../drizzle"),
).sort();

describe("migrateDatabase", () => {
  it.live("applies each migration once and records it in the journal", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // The test schema is first on the search path. Keeping the journal
      // there too isolates it from the shared `drizzle` schema.
      const [schema] = yield* sql<{
        readonly name: string;
      }>`select current_schema() as name`;

      assert.isDefined(schema);

      yield* migrateDatabase(schema.name);
      yield* migrateDatabase(schema.name);

      const journal = yield* sql<{ readonly name: string }>`
        select name from ${sql(schema.name)}.__drizzle_migrations order by id
      `;

      const tables = yield* sql<{ readonly name: string }>`
        select table_name as name from information_schema.tables
        where table_schema = ${schema.name} order by table_name
      `;

      assert.deepStrictEqual(
        journal.map((migration) => migration.name),
        migrationNames,
      );

      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["__drizzle_migrations", "users"],
      );
    }).pipe(withEmptyDatabase),
  );
});
