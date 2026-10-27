import { assert, describe, it } from "@effect/vitest";
import { Effect, Logger } from "effect";

import { UserRepositoryError } from "@node-effect/application";

import { databaseFailure, healthFailure } from "../http-errors.ts";

const sentinels = /SECRET_SENTINEL|SQL_SENTINEL|PARAM_SENTINEL/;

const repositoryError = (
  operation: UserRepositoryError["operation"],
  diagnostics: UserRepositoryError["diagnostics"],
) =>
  new UserRepositoryError({
    operation,
    cause: Object.assign(new Error("SECRET_SENTINEL"), {
      query: "select SQL_SENTINEL",
      params: ["PARAM_SENTINEL"],
    }),
    diagnostics,
  });

type FailureCase = {
  readonly name: string;
  readonly handle: (
    error: UserRepositoryError,
  ) => Effect.Effect<never, unknown>;
  readonly operation: UserRepositoryError["operation"];
  readonly diagnostics: UserRepositoryError["diagnostics"];
  readonly body: unknown;
  readonly logMessage: string;
};

const failureCases: ReadonlyArray<FailureCase> = [
  {
    name: "databaseFailure",
    handle: databaseFailure,
    operation: "list",
    diagnostics: { reason: "SchemaError", validationPaths: ["email"] },
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
    operation: "health",
    diagnostics: { reason: "AuthorizationError", code: "42501" },
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
          const error = repositoryError(
            testCase.operation,
            testCase.diagnostics,
          );

          const body = yield* testCase
            .handle(error)
            .pipe(Effect.flip, Effect.provide(Logger.layer([logger])));

          assert.deepStrictEqual(body, testCase.body);
          assert.lengthOf(lines, 1);
          const log = JSON.parse(lines.join(""));
          assert.strictEqual(log.level, "ERROR");
          assert.strictEqual(log.message, testCase.logMessage);
          assert.isUndefined(log.cause);
          assert.deepStrictEqual(log.annotations, {
            errorTag: "UserRepositoryError",
            operation: testCase.operation,
            diagnostics: testCase.diagnostics,
          });
          assert.notMatch(lines.join("\n"), sentinels);
        }),
    );
  }
});
