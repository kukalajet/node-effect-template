import { desc, eq, sql } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";

import { UserRepository } from "@node-effect/application";
import { AppConfig } from "@node-effect/config";
import {
  type CreateUser,
  type UserIdType,
  UserNotFound,
} from "@node-effect/domain";

import { Database, databaseCallTimeout } from "../postgres.ts";

import { UserRowSchema, users } from "./schema.ts";
import {
  toUserInsertError,
  toUserRepositoryError,
} from "./user-repository-error.ts";

const decodeUserRow = Schema.decodeUnknownEffect(UserRowSchema);
const decodeUserRows = Schema.decodeUnknownEffect(Schema.Array(UserRowSchema));

const makeUserRepository = Effect.gen(function* () {
  const database = yield* Database;
  const config = yield* AppConfig;

  // Each call sends one statement. Past this bound the server has stopped
  // answering, and the call fails as a TimeoutError (see databaseCallTimeout).
  const withinCallLimit = Effect.timeout(
    databaseCallTimeout(config.databaseStatementTimeoutMs),
  );

  const health = database.execute(sql`select 1`).pipe(
    Effect.timeout("5 seconds"),
    Effect.asVoid,
    Effect.mapError((cause) => toUserRepositoryError("health", cause)),
  );

  const insert = Effect.fn("UserRepository.insert")(function* (
    input: CreateUser,
  ) {
    const rows = yield* database
      .insert(users)
      .values(input)
      .returning()
      .pipe(
        withinCallLimit,
        Effect.mapError((cause) => toUserInsertError(input.email, cause)),
      );

    return yield* decodeUserRow(rows[0]).pipe(
      Effect.mapError((cause) => toUserRepositoryError("insert", cause)),
    );
  });

  const findById = Effect.fn("UserRepository.findById")(function* (
    id: UserIdType,
  ) {
    const rows = yield* database
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .pipe(
        withinCallLimit,
        Effect.mapError((cause) => toUserRepositoryError("findById", cause)),
      );

    const user = Option.fromUndefinedOr(rows[0]);

    if (Option.isNone(user)) {
      return yield* new UserNotFound({ id });
    }

    return yield* decodeUserRow(user.value).pipe(
      Effect.mapError((cause) => toUserRepositoryError("findById", cause)),
    );
  });

  // Users inserted in one transaction share created_at (now() is the
  // transaction's start time). The id breaks those ties, so the order, and
  // which users fall under the limit, stays the same between requests.
  const list = Effect.fn("UserRepository.list")(
    function* (limit: number) {
      const rows = yield* database
        .select()
        .from(users)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(limit)
        .pipe(withinCallLimit);

      return yield* decodeUserRows(rows);
    },
    Effect.mapError((cause) => toUserRepositoryError("list", cause)),
  );

  return UserRepository.of({ health, insert, findById, list });
});

const UserRepositoryLive = Layer.effect(UserRepository, makeUserRepository);

export { UserRepositoryLive };
