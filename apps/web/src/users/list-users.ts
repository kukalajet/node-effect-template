import { Query } from "@effect/ui";
import { Effect, Schema } from "effect";

import { CreateUserSchema, UserSchema } from "@node-effect/domain";

import { ApiClient, describeApiFailure } from "../api-client.ts";

// A user the API returned.
const SavedUser = Schema.TaggedStruct("SavedUser", { user: UserSchema });

// A user this page asked the API to create, shown until the API answers. It has
// no id or creation time yet: the API assigns both.
const PendingUser = Schema.TaggedStruct("PendingUser", {
  user: CreateUserSchema,
});

const UserRow = Schema.Union([SavedUser, PendingUser]);
type UserRow = typeof UserRow.Type;

// The API lists users newest first and has no cursor, so the page shows the
// newest 50, the API's own default.
const listedUsers = 50;

class ListUsers extends Query.Service<ListUsers>()("users/ListUsers", {
  args: {},
  success: Schema.Array(UserRow),
  error: Schema.String,
  staleTime: "30 seconds",
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const api = yield* ApiClient;

      return () =>
        api.users.list({ query: { limit: listedUsers } }).pipe(
          Effect.map(({ users }) =>
            users.map((user) => SavedUser.make({ user })),
          ),
          Effect.mapError(describeApiFailure),
        );
    }),
  );
}

export { ListUsers, PendingUser, SavedUser, UserRow };
