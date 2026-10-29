import { sql } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { DatabaseHealth, DatabaseHealthError } from "@node-effect/application";

import { diagnosticsFromCause } from "./error-diagnostics.ts";
import { Database } from "./postgres.ts";

// Readiness must answer before the probe gives up, so the check has its own
// short limit rather than the statement-based call limit.
const makeDatabaseHealth = Effect.gen(function* () {
  const database = yield* Database;

  const check = database.execute(sql`select 1`).pipe(
    Effect.timeout("5 seconds"),
    Effect.asVoid,
    Effect.mapError(
      (cause) =>
        new DatabaseHealthError({
          operation: "check",
          cause,
          diagnostics: diagnosticsFromCause(cause),
        }),
    ),
  );

  return DatabaseHealth.of({ check });
});

const DatabaseHealthLive = Layer.effect(DatabaseHealth, makeDatabaseHealth);

export { DatabaseHealthLive };
