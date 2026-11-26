import { HtmlCommand } from "@effect/ui/html";
import { Story } from "@effect/ui/testing";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { SavedUser } from "../list-users.ts";
import {
  CreateUser,
  CreateUserFailed,
  EmailInput,
  NameInput,
  NewUserForm,
  UsersPageMessage,
  UsersPageNoDeps,
} from "../users-page.ts";

const savedAda = {
  id: "0b6e7a8c-1d2f-4e3a-8b4c-5d6e7f8a9b0c",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  createdAt: new Date("2026-11-26T10:00:00.000Z"),
};

const typedAda = {
  form: NewUserForm.init({
    displayName: " Ada Lovelace ",
    email: " ada@example.com ",
  }),
  saving: false,
  failure: null,
};

describe("UsersPage", () => {
  it.effect("creates the user a valid form holds, trimmed", () =>
    Effect.gen(function* () {
      const story = yield* Story.make(UsersPageNoDeps, {});

      story
        .given(typedAda, { users: [] })
        .send(UsersPageMessage.SubmittedNewUser())
        .expectExact(CreateUser);

      assert.deepStrictEqual(story.pending[0]?.command.args, {
        user: { displayName: "Ada Lovelace", email: "ada@example.com" },
      });

      assert.isTrue(story.model.saving);

      // The success waits for the list the create invalidated.
      story.resolve(CreateUser, savedAda);

      assert.isTrue(story.model.saving);

      story
        .loaded("users", [SavedUser.make({ user: savedAda })])
        .expectExact(HtmlCommand.Focus);

      // The empty form takes focus, ready for the next user.
      assert.deepStrictEqual(story.pending[0]?.command.args, {
        ref: NameInput,
      });

      story.resolve(HtmlCommand.Focus, { found: true });

      assert.deepStrictEqual(story.model, {
        form: NewUserForm.init({ displayName: "", email: "" }),
        saving: false,
        failure: null,
      });
    }),
  );

  it.effect("keeps the form and says why when the API refuses the user", () =>
    Effect.gen(function* () {
      const story = yield* Story.make(UsersPageNoDeps, {});
      const reason = "A user with this email already exists";

      story
        .given(typedAda, { users: [] })
        .send(UsersPageMessage.SubmittedNewUser())
        .fail(CreateUser, new CreateUserFailed({ reason }))
        .expectExact(HtmlCommand.Focus);

      // The Email field takes focus: a refusal is most often for an email in
      // use.
      assert.deepStrictEqual(story.pending[0]?.command.args, {
        ref: EmailInput,
      });

      // The refusal did not wait for the list, which the failed create still
      // fetches again.
      story.resolve(HtmlCommand.Focus, { found: true }).loaded("users", []);

      assert.deepStrictEqual(story.model.form.values, typedAda.form.values);
      assert.isFalse(story.model.saving);
      assert.strictEqual(story.model.failure, reason);
    }),
  );

  it.effect("takes no second submit while a create runs", () =>
    Effect.gen(function* () {
      const story = yield* Story.make(UsersPageNoDeps, {});
      const saving = { ...typedAda, saving: true };

      story
        .given(saving, { users: [] })
        .send(UsersPageMessage.SubmittedNewUser())
        .expectNone();

      assert.deepStrictEqual(story.model, saving);
    }),
  );

  it.effect(
    "drops the last failure when the form is sent again, even invalid",
    () =>
      Effect.gen(function* () {
        const story = yield* Story.make(UsersPageNoDeps, {});

        const refused = {
          form: NewUserForm.init({ displayName: "Ada Lovelace", email: "" }),
          saving: false,
          failure: "A user with this email already exists",
        };

        story
          .given(refused, { users: [] })
          .send(UsersPageMessage.SubmittedNewUser())
          .expectNone();

        assert.isNull(story.model.failure);
        assert.isFalse(story.model.saving);
      }),
  );
});
