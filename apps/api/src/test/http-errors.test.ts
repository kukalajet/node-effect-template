import { assert, describe, it } from "@effect/vitest";
import { Effect, Logger } from "effect";

import {
  DatabaseHealthError,
  type PersistenceFailure,
  UserRepositoryError,
} from "@node-effect/application";

import { databaseFailure, healthFailure } from "../http-errors.ts";

const sentinels = /SECRET_SENTINEL|SQL_SENTINEL|PARAM_SENTINEL/;

// A raw cause carrying what must never reach a log line.
const sensitiveCause = () =>
  Object.assign(new Error("SECRET_SENTINEL"), {
    query: "select SQL_SENTINEL",
    params: ["PARAM_SENTINEL"],
  });

type FailureCase = {
  readonly name: string;
  readonly handle: (error: PersistenceFailure) => Effect.Effect<never, unknown>;
  readonly error: PersistenceFailure;
  readonly body: unknown;
  readonly logMessage: string;
};

const failureCases: ReadonlyArray<FailureCase> = [
  {
    name: "databaseFailure",
    handle: databaseFailure,
    error: new UserRepositoryError({
      operation: "list",
      cause: sensitiveCause(),
      diagnostics: { reason: "SchemaError", validationPaths: ["email"] },
    }),
    body: {
      error: {
        code: "DATABASE_ERROR",
        message: "The database operation could not be completed",
      },
    },
    logMessage: "Database operation failed",
  },
  {
    name: "healthFailure",
    handle: healthFailure,
    error: new DatabaseHealthError({
      operation: "check",
      cause: sensitiveCause(),
      diagnostics: { reason: "AuthorizationError", code: "42501" },
    }),
    body: {
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "The database is unavailable",
      },
    },
    logMessage: "Database health check failed",
  },
];

describe("http errors", () => {
  for (const testCase of failureCases) {
    it.effect(
      `${testCase.name} logs safe diagnostics and answers with a generic body`,
      () =>
        Effect.gen(function* () {
          const lines: Array<string> = [];

          const logger = Logger.map(Logger.formatJson, (line) => {
            lines.push(line);
          });

          const body = yield* testCase
            .handle(testCase.error)
            .pipe(Effect.flip, Effect.provide(Logger.layer([logger])));

          assert.deepStrictEqual(body, testCase.body);
          assert.lengthOf(lines, 1);
          const log = JSON.parse(lines.join(""));
          assert.strictEqual(log.level, "ERROR");
          assert.strictEqual(log.message, testCase.logMessage);
          assert.isUndefined(log.cause);

          assert.deepStrictEqual(log.annotations, {
            _tag: testCase.error._tag,
            operation: testCase.error.operation,
            diagnostics: testCase.error.diagnostics,
          });

          assert.notMatch(lines.join("\n"), sentinels);
        }),
    );
  }
});
