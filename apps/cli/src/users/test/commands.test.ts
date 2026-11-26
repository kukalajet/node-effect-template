import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { CliError } from "effect/cli";

import {
  UserPersistenceFailure,
  UserRepository,
} from "@node-effect/application";
import {
  type User,
  UserAlreadyExists,
  UserId,
  UserNotFound,
} from "@node-effect/domain";

import { runCommand } from "../../test/command-runner.fixtures.ts";
import { usersCommand } from "../commands.ts";

const userId = Schema.decodeUnknownSync(UserId)(
  "d5b9d3de-fda5-4a78-b8a5-2f3b60634d95",
);

const createdAt = new Date("2026-08-09T12:00:00.000Z");

const user: User = {
  id: userId,
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  createdAt,
};

// The line a command prints for `user`: the JSON the API sends for one.
const userJson = { ...user, createdAt: createdAt.toISOString() };
const userLine = JSON.stringify(userJson);

const unknownUserId = "00000000-0000-4000-8000-000000000000";

// Records every insert, lookup and list limit, so a test can tell whether a
// command got that far and what it asked for.
const fakeRepository = (overrides: Partial<UserRepository["Service"]> = {}) => {
  const inserted: Array<unknown> = [];
  const lookedUp: Array<string> = [];
  const listLimits: Array<number> = [];

  const layer = Layer.succeed(
    UserRepository,
    UserRepository.of({
      insert: (input) =>
        Effect.sync(() => {
          inserted.push(input);

          return { ...user, ...input };
        }),
      findById: (id) =>
        Effect.suspend(() => {
          lookedUp.push(id);

          return id === userId
            ? Effect.succeed(user)
            : Effect.fail(new UserNotFound({ id }));
        }),
      list: (limit) =>
        Effect.sync(() => {
          listLimits.push(limit);

          return [user, user];
        }),
      ...overrides,
    }),
  );

  return { inserted, layer, listLimits, lookedUp };
};

// Runs `users <args>` with `repository`.
const runUsers = (
  repository: ReturnType<typeof fakeRepository>,
  ...args: ReadonlyArray<string>
) => runCommand(usersCommand, args).pipe(Effect.provide(repository.layer));

// The UserError a command failed with, whose message effect/cli printed.
const userErrorOf = (exit: Exit.Exit<void, unknown>) => {
  assert(Exit.isFailure(exit));
  const error = Cause.squash(exit.cause);
  assert(CliError.isCliError(error) && error._tag === "UserError");

  return error;
};

// Invalid input fails with ShowHelp, which effect/cli printed with the
// command's help and the error.
const assertInvalidInput = (
  result: Effect.Success<ReturnType<typeof runCommand>>,
  message: string,
) => {
  assert(Exit.isFailure(result.exit));
  const error = Cause.squash(result.exit.cause);
  assert(CliError.isCliError(error) && error._tag === "ShowHelp");
  assert.include(result.output.join("\n"), "USAGE");
  assert.include(result.errors.join("\n"), message);
};

describe("users list", () => {
  it.effect("prints each user as a line of JSON, reading 50 by default", () =>
    Effect.gen(function* () {
      const repository = fakeRepository();
      const result = yield* runUsers(repository, "list");

      assert.isTrue(Exit.isSuccess(result.exit));
      assert.deepStrictEqual(result.output, [userLine, userLine]);
      assert.deepStrictEqual(result.errors, []);
      assert.deepStrictEqual(repository.listLimits, [50]);
    }),
  );

  for (const limit of ["1", "100"]) {
    it.effect(`reads at most ${limit} users with --limit ${limit}`, () =>
      Effect.gen(function* () {
        const repository = fakeRepository();
        const result = yield* runUsers(repository, "list", "--limit", limit);

        assert.isTrue(Exit.isSuccess(result.exit));
        assert.deepStrictEqual(repository.listLimits, [Number(limit)]);
      }),
    );
  }

  for (const limit of ["0", "101", "ten"]) {
    it.effect(`refuses --limit ${limit} before reading anything`, () =>
      Effect.gen(function* () {
        const repository = fakeRepository();
        const result = yield* runUsers(repository, "list", "--limit", limit);

        assertInvalidInput(result, "Invalid value for flag --limit");
        assert.deepStrictEqual(repository.listLimits, []);
      }),
    );
  }

  it.effect("prints nothing when there are no users", () =>
    Effect.gen(function* () {
      const repository = fakeRepository({ list: () => Effect.succeed([]) });
      const result = yield* runUsers(repository, "list");

      assert.isTrue(Exit.isSuccess(result.exit));
      assert.deepStrictEqual(result.output, []);
    }),
  );
});

describe("users get", () => {
  it.effect("prints the user with that id", () =>
    Effect.gen(function* () {
      const repository = fakeRepository();
      const result = yield* runUsers(repository, "get", userId);

      assert.isTrue(Exit.isSuccess(result.exit));
      assert.deepStrictEqual(result.output, [userLine]);
      assert.deepStrictEqual(repository.lookedUp, [userId]);
    }),
  );

  it.effect("answers an unknown id with a message on standard error", () =>
    Effect.gen(function* () {
      const repository = fakeRepository();
      const result = yield* runUsers(repository, "get", unknownUserId);
      const error = userErrorOf(result.exit);

      assert.strictEqual(error.message, "User not found");
      assert(error.cause instanceof UserNotFound);
      assert.include(result.errors.join("\n"), "User not found");
      assert.deepStrictEqual(result.output, []);
    }),
  );

  it.effect("refuses an id that is not a UUID before looking it up", () =>
    Effect.gen(function* () {
      const repository = fakeRepository();
      const result = yield* runUsers(repository, "get", "not-a-uuid");

      assertInvalidInput(result, "Invalid value for argument <id>");
      assert.deepStrictEqual(repository.lookedUp, []);
    }),
  );
});

describe("users create", () => {
  it.effect("inserts the trimmed input and prints the new user", () =>
    Effect.gen(function* () {
      const repository = fakeRepository();

      const result = yield* runUsers(
        repository,
        "create",
        "--email",
        " grace@example.com ",
        "--display-name",
        " Grace Hopper ",
      );

      const input = { email: "grace@example.com", displayName: "Grace Hopper" };
      const createdLine = JSON.stringify({ ...userJson, ...input });

      assert.isTrue(Exit.isSuccess(result.exit));
      assert.deepStrictEqual(repository.inserted, [input]);
      assert.deepStrictEqual(result.output, [createdLine]);
    }),
  );

  it.effect("answers a taken email with a message on standard error", () =>
    Effect.gen(function* () {
      const repository = fakeRepository({
        insert: (input) =>
          Effect.fail(new UserAlreadyExists({ email: input.email })),
      });

      const result = yield* runUsers(
        repository,
        "create",
        "--email",
        "ada@example.com",
        "--display-name",
        "Ada",
      );

      const error = userErrorOf(result.exit);
      const message = "A user with this email already exists";

      assert.strictEqual(error.message, message);
      assert.include(result.errors.join("\n"), message);
      assert.deepStrictEqual(result.output, []);
    }),
  );

  for (const testCase of [
    {
      name: "an email without a domain",
      args: ["--email", "ada", "--display-name", "Ada"],
      message: "Invalid value for flag --email",
    },
    {
      name: "a blank name",
      args: ["--email", "ada@example.com", "--display-name", "  "],
      message: "Invalid value for flag --display-name",
    },
    {
      name: "a missing name",
      args: ["--email", "ada@example.com"],
      message: "Missing required flag: --display-name",
    },
  ]) {
    it.effect(`refuses ${testCase.name} before inserting`, () =>
      Effect.gen(function* () {
        const repository = fakeRepository();
        const result = yield* runUsers(repository, "create", ...testCase.args);

        assertInvalidInput(result, testCase.message);
        assert.deepStrictEqual(repository.inserted, []);
      }),
    );
  }
});

describe("users commands", () => {
  it.effect("leave a persistence failure to the failure reporter", () =>
    Effect.gen(function* () {
      const failure = new UserPersistenceFailure({
        operation: "list",
        cause: new Error("Unreachable PostgreSQL"),
        diagnostics: { reason: "ConnectionError", code: "ECONNREFUSED" },
      });

      const repository = fakeRepository({ list: () => Effect.fail(failure) });
      const result = yield* runUsers(repository, "list");

      assert(Exit.isFailure(result.exit));
      assert.strictEqual(Cause.squash(result.exit.cause), failure);
      assert.deepStrictEqual(result.output, []);
      assert.deepStrictEqual(result.errors, []);
    }),
  );
});
