import { assert, describe, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Exit, Logger } from "effect";
import { SqlError } from "effect/sql";

import { reportMigrationFailure } from "../migrate.ts";

const sentinels =
  /SECRET_SENTINEL|SQL_SENTINEL|PARAM_SENTINEL|ROLLBACK_SENTINEL/;

const connectionLost = (message: string) =>
  new SqlError.SqlError({
    reason: new SqlError.ConnectionError({
      cause: Object.assign(new Error(message), { code: "57P01" }),
      message,
    }),
  });

// What drizzle fails with when a migration statement fails.
const failedStatement = () =>
  new EffectDrizzleQueryError({
    query: 'CREATE TABLE "SQL_SENTINEL" ()',
    params: ["PARAM_SENTINEL"],
    cause: Cause.fail(connectionLost("SECRET_SENTINEL")),
  });

// Runs `program` through the migration reporter and returns its exit and log
// lines.
const runMigration = <E>(program: Effect.Effect<void, E>) =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    const logger = Logger.map(Logger.formatJson, (line) => {
      lines.push(line);
    });
    const exit = yield* program.pipe(
      Effect.tapCause(reportMigrationFailure),
      Effect.provide(Logger.layer([logger])),
      Effect.exit,
    );

    return { exit, output: lines.join("\n"), lineCount: lines.length };
  });

describe("migration failure reporting", () => {
  it.effect("logs a failed statement by its tag and diagnostics", () =>
    Effect.gen(function* () {
      const error = failedStatement();
      const { exit, output, lineCount } = yield* runMigration(
        Effect.fail(error),
      );

      assert(Exit.isFailure(exit));
      assert.strictEqual(Cause.squash(exit.cause), error);
      assert.strictEqual(lineCount, 1);
      assert.match(output, /Database migration failed/);
      assert.match(output, /EffectDrizzleQueryError/);
      assert.match(output, /ConnectionError/);
      assert.match(output, /57P01/);
      assert.notMatch(output, sentinels);
    }),
  );

  it.effect(
    "redacts a failed statement that a dying rollback turns into a defect",
    () =>
      Effect.gen(function* () {
        const error = failedStatement();
        // Like drizzle's migration transaction when the connection is lost:
        // its ROLLBACK dies, and Effect reports the statement's failure as a
        // defect too.
        const { exit, output, lineCount } = yield* runMigration(
          Effect.fail(error).pipe(
            Effect.onExit(() =>
              Effect.die(connectionLost("ROLLBACK_SENTINEL")),
            ),
          ),
        );

        assert(Exit.isFailure(exit));
        assert.lengthOf(exit.cause.reasons, 2);
        assert.isTrue(exit.cause.reasons.every(Cause.isDieReason));
        assert.strictEqual(Cause.squash(exit.cause), error);
        assert.strictEqual(lineCount, 1);
        assert.match(output, /EffectDrizzleQueryError/);
        assert.match(output, /ConnectionError/);
        assert.notMatch(output, sentinels);
      }),
  );

  it.effect("keeps the details of a failure that is not a database's", () =>
    Effect.gen(function* () {
      const { output } = yield* runMigration(
        Effect.fail(new Error("MISSING_CONFIGURATION")),
      );

      assert.match(output, /MISSING_CONFIGURATION/);
    }),
  );

  it.effect("stays quiet on interruption", () =>
    Effect.gen(function* () {
      const { lineCount } = yield* runMigration(Effect.interrupt);

      assert.strictEqual(lineCount, 0);
    }),
  );
});
