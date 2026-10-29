import { desc, eq } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";

import { UserRepository, UserRepositoryError } from "@node-effect/application";
import {
  type CreateUser,
  type UserIdType,
  UserNotFound,
} from "@node-effect/domain";

import { repositoryCalls } from "../database-call.ts";
import { Database } from "../postgres.ts";

import { UserRowSchema, users } from "./schema.ts";
import { userEmailConflict } from "./user-repository-error.ts";

const UserRows = Schema.Array(UserRowSchema);
const InsertedUserRow = Schema.Tuple([UserRowSchema]);

const makeUserRepository = Effect.gen(function* () {
  const database = yield* Database;
  const calls = yield* repositoryCalls(UserRepositoryError);

  const insert = Effect.fn("UserRepository.insert")(function* (
    input: CreateUser,
  ) {
    const [user] = yield* calls.rows(
      "insert",
      database.insert(users).values(input).returning(),
      InsertedUserRow,
      (cause) => userEmailConflict(input.email, cause),
    );

    return user;
  });

  const findById = Effect.fn("UserRepository.findById")(function* (
    id: UserIdType,
  ) {
    const rows = yield* calls.rows(
      "findById",
      database.select().from(users).where(eq(users.id, id)).limit(1),
      UserRows,
    );

    const user = Option.fromUndefinedOr(rows[0]);

    if (Option.isNone(user)) {
      return yield* new UserNotFound({ id });
    }

    return user.value;
  });

  // Users inserted in one transaction share created_at (now() is the
  // transaction's start time). The id breaks those ties, so the order, and
  // which users fall under the limit, stays the same between requests.
  const list = Effect.fn("UserRepository.list")(function* (limit: number) {
    return yield* calls.rows(
      "list",
      database
        .select()
        .from(users)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(limit),
      UserRows,
    );
  });

  return UserRepository.of({ insert, findById, list });
});

const UserRepositoryLive = Layer.effect(UserRepository, makeUserRepository);

export { UserRepositoryLive };
