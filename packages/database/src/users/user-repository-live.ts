import { desc, eq } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";

import { UserRepository, UserRepositoryError } from "@node-effect/application";
import { AppConfig } from "@node-effect/config";
import {
  type CreateUser,
  type UserIdType,
  UserNotFound,
} from "@node-effect/domain";

import { databaseCalls } from "../database-call.ts";
import { Database, databaseCallTimeout } from "../postgres.ts";

import { UserRowSchema, users } from "./schema.ts";
import { userEmailConflict } from "./user-repository-error.ts";

const decodeUserRow = Schema.decodeUnknownEffect(UserRowSchema);
const decodeUserRows = Schema.decodeUnknownEffect(Schema.Array(UserRowSchema));

const makeUserRepository = Effect.gen(function* () {
  const database = yield* Database;
  const config = yield* AppConfig;

  const calls = databaseCalls(
    UserRepositoryError,
    databaseCallTimeout(config.databaseStatementTimeoutMs),
  );

  const insert = Effect.fn("UserRepository.insert")(function* (
    input: CreateUser,
  ) {
    const rows = yield* calls.run(
      "insert",
      database.insert(users).values(input).returning(),
      (cause) => userEmailConflict(input.email, cause),
    );

    return yield* decodeUserRow(rows[0]).pipe(calls.failAs("insert"));
  });

  const findById = Effect.fn("UserRepository.findById")(function* (
    id: UserIdType,
  ) {
    const rows = yield* calls.run(
      "findById",
      database.select().from(users).where(eq(users.id, id)).limit(1),
    );

    const user = Option.fromUndefinedOr(rows[0]);

    if (Option.isNone(user)) {
      return yield* new UserNotFound({ id });
    }

    return yield* decodeUserRow(user.value).pipe(calls.failAs("findById"));
  });

  // Users inserted in one transaction share created_at (now() is the
  // transaction's start time). The id breaks those ties, so the order, and
  // which users fall under the limit, stays the same between requests.
  const list = Effect.fn("UserRepository.list")(function* (limit: number) {
    const rows = yield* calls.run(
      "list",
      database
        .select()
        .from(users)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(limit),
    );

    return yield* decodeUserRows(rows).pipe(calls.failAs("list"));
  });

  return UserRepository.of({ insert, findById, list });
});

const UserRepositoryLive = Layer.effect(UserRepository, makeUserRepository);

export { UserRepositoryLive };
