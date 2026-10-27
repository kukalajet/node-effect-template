import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { UserRepository, UserRepositoryError } from "@node-effect/application";
import { UserNotFound } from "@node-effect/domain";

import { DatabaseLive } from "../../postgres.ts";
import { connectionWithRows, pgClientLayer } from "../../test/pg-client.ts";
import { UserRepositoryLive } from "../user-repository-live.ts";

const repositoryWithRows = (rows: ReadonlyArray<ReadonlyArray<unknown>>) =>
  UserRepositoryLive.pipe(
    Layer.provide(DatabaseLive),
    Layer.provide(pgClientLayer(Effect.succeed(connectionWithRows(rows)))),
  );

const user = {
  id: "d5b9d3de-fda5-4a78-b8a5-2f3b60634d95",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  createdAt: new Date("2026-08-09T12:00:00.000Z"),
};

const input = { email: user.email, displayName: user.displayName };

const storedRow = [
  user.id,
  "  ada@example.com  ",
  "  Ada Lovelace  ",
  user.createdAt.toISOString(),
];

const invalidRows = [
  {
    field: "email",
    path: "email",
    row: [
      user.id,
      "not-an-email",
      user.displayName,
      user.createdAt.toISOString(),
    ],
  },
  {
    field: "display name",
    path: "displayName",
    row: [user.id, user.email, "   ", user.createdAt.toISOString()],
  },
];

const runOperation = (operation: "insert" | "findById" | "list") =>
  Effect.gen(function* () {
    const repository = yield* UserRepository;

    switch (operation) {
      case "insert":
        return [yield* repository.insert(input)];
      case "findById":
        return [yield* repository.findById(user.id)];
      case "list":
        return yield* repository.list();
    }
  });

describe("UserRepositoryLive", () => {
  for (const operation of ["insert", "findById", "list"] as const) {
    it.effect(`${operation} decodes and normalizes persisted rows`, () =>
      Effect.gen(function* () {
        const result = yield* runOperation(operation);

        assert.deepStrictEqual(result, [user]);
      }).pipe(Effect.provide(repositoryWithRows([storedRow]))),
    );

    for (const { field, path, row } of invalidRows) {
      it.effect(`${operation} rejects an invalid persisted ${field}`, () =>
        Effect.gen(function* () {
          const failure = yield* runOperation(operation).pipe(Effect.flip);

          assert.instanceOf(failure, UserRepositoryError);
          assert.strictEqual(failure.operation, operation);
          assert.isTrue(Schema.isSchemaError(failure.cause));

          assert.deepStrictEqual(failure.diagnostics, {
            reason: "SchemaError",
            validationPaths: [operation === "list" ? `1.${path}` : path],
          });
        }).pipe(
          Effect.provide(
            repositoryWithRows(operation === "list" ? [storedRow, row] : [row]),
          ),
        ),
      );
    }
  }

  it.effect("findById reports a missing row as UserNotFound", () =>
    Effect.gen(function* () {
      const repository = yield* UserRepository;
      const failure = yield* repository.findById(user.id).pipe(Effect.flip);

      assert.instanceOf(failure, UserNotFound);
      assert.strictEqual(failure.id, user.id);
    }).pipe(Effect.provide(repositoryWithRows([]))),
  );

  it.effect("list returns an empty result unchanged", () =>
    Effect.gen(function* () {
      const repository = yield* UserRepository;

      assert.deepStrictEqual(yield* repository.list(), []);
    }).pipe(Effect.provide(repositoryWithRows([]))),
  );
});
