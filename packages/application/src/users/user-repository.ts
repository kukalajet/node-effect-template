import { Context, Effect, Schema } from "effect";

import {
  type CreateUser,
  type User,
  UserAlreadyExists,
  type UserIdType,
  UserNotFound,
} from "@node-effect/domain";

import { persistenceFailureFields } from "../persistence-failure.ts";

const repositoryOperations = ["health", "insert", "findById", "list"] as const;

class UserRepositoryError extends Schema.TaggedError<UserRepositoryError>()(
  "UserRepositoryError",
  persistenceFailureFields(repositoryOperations),
) {}

class UserRepository extends Context.Service<
  UserRepository,
  {
    readonly health: Effect.Effect<void, UserRepositoryError>;
    readonly insert: (
      input: CreateUser,
    ) => Effect.Effect<User, UserAlreadyExists | UserRepositoryError>;
    readonly findById: (
      id: UserIdType,
    ) => Effect.Effect<User, UserNotFound | UserRepositoryError>;
    // At most `limit` users, newest first.
    readonly list: (
      limit: number,
    ) => Effect.Effect<ReadonlyArray<User>, UserRepositoryError>;
  }
>()("@node-effect/application/UserRepository") {}

export { UserRepository, UserRepositoryError };
