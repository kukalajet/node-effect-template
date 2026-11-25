import { Console, Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { UserRepository } from "@node-effect/application";
import {
  DisplayName,
  Email,
  type User,
  UserId,
  UserSchema,
} from "@node-effect/domain";

import { userError } from "../cli-errors.ts";

// As for GET /users: the list has no cursor, so `--limit` caps what one
// command reads.
const ListLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 100 }),
);

// A user as the JSON the API sends for one.
const encodeUser = Schema.encodeEffect(Schema.fromJsonString(UserSchema));

// One line of JSON per user, which reads well in a terminal and in jq.
const printUsers = (users: ReadonlyArray<User>) =>
  Effect.forEach(
    users,
    (user) =>
      encodeUser(user).pipe(Effect.flatMap((line) => Console.log(line))),
    { discard: true },
  );

const listUsers = Command.make(
  "list",
  {
    limit: Flag.Int("limit").pipe(
      Flag.withSchema(ListLimit),
      Flag.withDefault(50),
      Flag.withDescription("How many users to print, 1 to 100 (default 50)"),
    ),
  },
  Effect.fn("Cli.listUsers")(function* ({ limit }) {
    const repository = yield* UserRepository;
    const users = yield* repository.list(limit);

    yield* printUsers(users);
  }),
).pipe(Command.withDescription("Print users, newest first"));

const getUser = Command.make(
  "get",
  {
    id: Argument.String("id").pipe(
      Argument.withSchema(UserId),
      Argument.withDescription("The user's id, a UUID"),
    ),
  },
  Effect.fn("Cli.getUser")(
    function* ({ id }) {
      const repository = yield* UserRepository;
      const user = yield* repository.findById(id);

      yield* printUsers([user]);
    },
    Effect.catchTag("UserNotFound", userError("User not found")),
  ),
).pipe(Command.withDescription("Print one user"));

const createUser = Command.make(
  "create",
  {
    email: Flag.String("email").pipe(
      Flag.withSchema(Email),
      Flag.withDescription("The user's email address"),
    ),
    displayName: Flag.String("display-name").pipe(
      Flag.withSchema(DisplayName),
      Flag.withDescription("The user's name, up to 100 characters"),
    ),
  },
  Effect.fn("Cli.createUser")(
    function* (input) {
      const repository = yield* UserRepository;
      const user = yield* repository.insert(input);

      yield* printUsers([user]);
    },
    Effect.catchTag(
      "UserAlreadyExists",
      userError("A user with this email already exists"),
    ),
  ),
).pipe(Command.withDescription("Create a user and print it"));

const usersCommand = Command.make("users").pipe(
  Command.withDescription("Read and create users"),
  Command.withSubcommands([listUsers, getUser, createUser]),
);

export { usersCommand };
