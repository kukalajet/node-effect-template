import { Schema } from "effect";
import { HttpApiSchema } from "effect/http-api";

// Every public error has the same envelope. The code and message are literals,
// so the OpenAPI document lists exactly what a client can receive.
const publicError = <const Code extends string, const Message extends string>(
  status: number,
  code: Code,
  message: Message,
) =>
  Schema.Struct({
    error: Schema.Struct({
      code: Schema.Literal(code),
      message: Schema.Literal(message),
    }),
  }).pipe(HttpApiSchema.status(status));

const BadRequestResponse = publicError(
  400,
  "INVALID_REQUEST",
  "The request payload is invalid",
);

const PayloadTooLargeResponse = publicError(
  413,
  "PAYLOAD_TOO_LARGE",
  "The request payload is too large",
);

const DatabaseErrorResponse = publicError(
  500,
  "DATABASE_ERROR",
  "The database operation could not be completed",
);

const DatabaseUnavailableResponse = publicError(
  503,
  "DATABASE_UNAVAILABLE",
  "The database is unavailable",
);

export {
  BadRequestResponse,
  DatabaseErrorResponse,
  DatabaseUnavailableResponse,
  PayloadTooLargeResponse,
  publicError,
};
