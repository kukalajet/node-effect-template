import { Effect, Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

import { CreateUserSchema, UserId, UserSchema } from "@node-effect/domain";

import { RequestValidation } from "../api-middleware.ts";
import {
  DatabaseErrorResponse,
  PayloadTooLargeResponse,
  publicError,
} from "../api-schemas.ts";

const UserParams = Schema.Struct({ id: UserId });

// The list has no cursor, so `limit` caps what one request can read. A project
// that needs to page past the cap adds its own pagination.
const UserListQuery = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(50)),
  ),
});

const UserListResponse = Schema.Struct({ users: Schema.Array(UserSchema) });

const UserNotFoundResponse = publicError(
  404,
  "USER_NOT_FOUND",
  "User not found",
);

const UserAlreadyExistsResponse = publicError(
  409,
  "USER_ALREADY_EXISTS",
  "A user with this email already exists",
);

const UsersApi = HttpApiGroup.make("users")
  .add(
    // The OpenAPI document describes a query parameter by its string encoding,
    // so the description states the range and default.
    HttpApiEndpoint.get("list", "/users", {
      query: UserListQuery,
      success: UserListResponse,
      error: DatabaseErrorResponse,
    }).annotate(
      OpenApi.Description,
      "Lists users, newest first. `limit` is an integer from 1 to 100 and defaults to 50.",
    ),
    HttpApiEndpoint.get("get", "/users/:id", {
      params: UserParams,
      success: UserSchema,
      error: [UserNotFoundResponse, DatabaseErrorResponse],
    }),
    // The handler reads the body itself (see request-body.ts); `payload` only
    // documents it.
    HttpApiEndpoint.post("create", "/users", {
      payload: CreateUserSchema,
      success: UserSchema.pipe(HttpApiSchema.status(201)),
      error: [
        PayloadTooLargeResponse,
        UserAlreadyExistsResponse,
        DatabaseErrorResponse,
      ],
    }),
  )
  .middleware(RequestValidation);

export {
  UserAlreadyExistsResponse,
  UserListQuery,
  UserNotFoundResponse,
  UserParams,
  UsersApi,
};
