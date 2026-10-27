import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { UserRepository } from "@node-effect/application";
import { CreateUserSchema } from "@node-effect/domain";

import { Api } from "../api-contract.ts";
import { RequestValidationLive } from "../api-middleware.ts";
import { databaseFailure } from "../http-errors.ts";
import { jsonBody } from "../request-body.ts";

import {
  UserAlreadyExistsResponse,
  UserNotFoundResponse,
  type UserParams,
} from "./api-contract.ts";

// A valid body is under 2 KiB: a 320-character email and a 100-character
// display name at up to 4 UTF-8 bytes per character, plus the JSON around them.
const createUserBodyMaxBytes = 4 * 1024;

const userNotFound = UserNotFoundResponse.make({
  error: { code: "USER_NOT_FOUND", message: "User not found" },
});

const userAlreadyExists = UserAlreadyExistsResponse.make({
  error: {
    code: "USER_ALREADY_EXISTS",
    message: "A user with this email already exists",
  },
});

const listUsers = Effect.gen(function* () {
  const repository = yield* UserRepository;
  const users = yield* repository.list();

  return { users };
}).pipe(Effect.catchTag("UserRepositoryError", databaseFailure));

const getUser = ({ id }: typeof UserParams.Type) =>
  Effect.gen(function* () {
    const repository = yield* UserRepository;

    return yield* repository.findById(id);
  }).pipe(
    Effect.catchTags({
      UserNotFound: () => Effect.fail(userNotFound),
      UserRepositoryError: databaseFailure,
    }),
  );

const createUser = Effect.gen(function* () {
  const input = yield* jsonBody(CreateUserSchema, createUserBodyMaxBytes);
  const repository = yield* UserRepository;

  return yield* repository.insert(input);
}).pipe(
  Effect.catchTags({
    UserAlreadyExists: () => Effect.fail(userAlreadyExists),
    UserRepositoryError: databaseFailure,
  }),
);

const UserHandlers = HttpApiBuilder.group(Api, "users", (handlers) =>
  handlers
    .handle("list", () => listUsers)
    .handle("get", ({ params }) => getUser(params))
    .handleRaw("create", () => createUser),
).pipe(Layer.provide(RequestValidationLive));

export { UserHandlers };
