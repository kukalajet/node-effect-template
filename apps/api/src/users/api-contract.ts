import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { CreateUserSchema, UserId, UserSchema } from "@node-effect/domain";

import { RequestValidation } from "../api-middleware.ts";
import {
  DatabaseErrorResponse,
  PayloadTooLargeResponse,
  publicError,
} from "../api-schemas.ts";

const UserParams = Schema.Struct({ id: UserId });

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
    HttpApiEndpoint.get("list", "/users", {
      success: UserListResponse,
      error: DatabaseErrorResponse,
    }),
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
  UserNotFoundResponse,
  UserParams,
  UsersApi,
};
