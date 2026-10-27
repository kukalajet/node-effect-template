import { Effect } from "effect";

import type { PersistenceFailure } from "@node-effect/application";

import {
  DatabaseErrorResponse,
  DatabaseUnavailableResponse,
} from "./api-schemas.ts";

const databaseError = DatabaseErrorResponse.make({
  error: {
    code: "DATABASE_ERROR",
    message: "The database operation could not be completed",
  },
});

const databaseUnavailable = DatabaseUnavailableResponse.make({
  error: {
    code: "DATABASE_UNAVAILABLE",
    message: "The database is unavailable",
  },
});

// The cause can carry SQL, parameters, and stored values, so only the safe
// diagnostics reach the log, and the response says nothing about the failure.
const logPersistenceFailure = (message: string, error: PersistenceFailure) =>
  Effect.logError(message).pipe(
    Effect.annotateLogs({
      errorTag: error._tag,
      operation: error.operation,
      diagnostics: error.diagnostics,
    }),
  );

// A failed operation is a server error: 500.
const databaseFailure = (error: PersistenceFailure) =>
  logPersistenceFailure("Database operation failed", error).pipe(
    Effect.andThen(Effect.fail(databaseError)),
  );

// A failed readiness check means the database cannot serve traffic: 503.
const healthFailure = (error: PersistenceFailure) =>
  logPersistenceFailure("Database health check failed", error).pipe(
    Effect.andThen(Effect.fail(databaseUnavailable)),
  );

export { databaseFailure, healthFailure };
