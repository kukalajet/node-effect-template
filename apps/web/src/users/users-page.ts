import { Command, Component, UiSchema, Validation } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Layer, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import {
  CreateUserSchema,
  DisplayName,
  Email,
  UserSchema,
} from "@node-effect/domain";

import { ApiClient, describeApiFailure } from "../api-client.ts";

import { ListUsers, PendingUser, type UserRow } from "./list-users.ts";

// A value of spaces alone is empty: the API would trim it to nothing.
const isBlank = (value: string) => value.trim() === "";

// The form that adds a user. Each field is checked with the schema the API
// decodes it with, so the form refuses what the API would refuse.
const NewUserForm = Validation.make({
  displayName: {
    required: "Enter a name.",
    isEmpty: isBlank,
    rules: [
      Validation.Rule.fromSchema(
        DisplayName,
        "Use at most 100 characters, and no control characters.",
      ),
    ],
  },
  email: {
    required: "Enter an email address.",
    isEmpty: isBlank,
    rules: [
      Validation.Rule.fromSchema(
        Email,
        "Enter an email address such as ada@example.com.",
      ),
    ],
  },
});

const emptyForm = NewUserForm.init({ displayName: "", email: "" });

// A valid form's values as the API stores them: decoding trims them.
const decodeNewUser = Schema.decodeOption(CreateUserSchema);

const UsersPageModel = Schema.Struct({
  form: NewUserForm.State,
  // A create is running: the form takes no other submit until it ends.
  saving: Schema.Boolean,
  // Why the last create failed, until the form is submitted again.
  failure: Schema.NullOr(Schema.String),
});
type UsersPageModel = typeof UsersPageModel.Type;

const UsersPageMessage = UiSchema.TaggedEnum({
  UpdatedDisplayName: { value: Schema.String },
  UpdatedEmail: { value: Schema.String },
  SubmittedNewUser: {},
  SucceededCreateUser: { user: UserSchema },
  FailedCreateUser: { reason: Schema.String },
});
type UsersPageMessage = typeof UsersPageMessage.Type;

// The API did not create the user, for `reason`.
class CreateUserFailed extends Schema.TaggedError<CreateUserFailed>()(
  "CreateUserFailed",
  { reason: Schema.String },
) {}

// Asks the API to create a user. Until it answers, the list shows the user at
// its top, where the API's newest-first order puts a new one.
//
// The body fails when the API refuses, rather than turning the refusal into a
// message itself: a run that fails takes its patch off the list at once, while
// one that succeeds keeps it until the list is fetched again.
class CreateUser extends Command.Service<CreateUser>()("users/CreateUser", {
  args: { user: CreateUserSchema },
  success: UserSchema,
  error: CreateUserFailed,
  optimistic: ({ user }) => [
    ListUsers.patch({}, (rows) => [PendingUser.make({ user }), ...rows]),
  ],
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const api = yield* ApiClient;

      return ({ user }) =>
        api.users
          .create({ payload: user })
          .pipe(
            Effect.mapError(
              (failure) =>
                new CreateUserFailed({ reason: describeApiFailure(failure) }),
            ),
          );
    }),
  );
}

// The success waits for the list to be fetched again, so the saved user
// replaces the pending one in the render that empties the form. The budget only
// bounds that wait: a refetch takes a fraction of a second.
const createUser = (user: typeof CreateUserSchema.Type) =>
  CreateUser.make({ user }).pipe(
    Command.match({
      onSuccess: (created) =>
        UsersPageMessage.SucceededCreateUser({ user: created }),
      onFailure: ({ reason }) => UsersPageMessage.FailedCreateUser({ reason }),
    }),
    Command.afterRefetch("5 seconds"),
  );

const UsersPageDef = Html.component({
  name: "UsersPage",
  model: UsersPageModel,
  message: UsersPageMessage,
  queries: {
    users: { query: ListUsers, args: () => ({}) },
  },
});

// A valid form asks the API to create the user, unless a create is already
// running. An invalid one only shows each field's error.
const submittedNewUser = UsersPageDef.update("SubmittedNewUser", ($) => {
  if ($.model.saving) return $.model;

  const form = NewUserForm.submit($.model.form);
  const user = Option.flatMap(NewUserForm.validate(form).value, decodeNewUser);

  if (Option.isNone(user)) return $.evolve({ form });

  return $.evolve({ form, saving: true, failure: null }).run(
    createUser(user.value),
  );
});

// The first error of a field whose mode lets it show one.
const shownError = (field: Validation.Field<string>): string | undefined => {
  if (field._tag !== "Invalid") return undefined;

  return field.errors[0];
};

const TextField = <Msg>(
  h: Html.H<Msg>,
  options: {
    readonly label: string;
    readonly name: string;
    readonly type: "email" | "text";
    readonly autocomplete: string;
    readonly field: Validation.Field<string>;
    readonly onInput: (value: string) => Msg;
  },
) => {
  const inputId = h.id(options.name);
  const errorId = h.id(`${options.name}-error`);
  const error = shownError(options.field);

  return h.div.class("field").children(
    h.label.attr("for", inputId).children(options.label),
    h.input
      .id(inputId)
      .attrs({
        type: options.type,
        name: options.name,
        autocomplete: options.autocomplete,
        "aria-invalid": String(error !== undefined),
        "aria-describedby": error === undefined ? undefined : errorId,
      })
      .value(options.field.value)
      .on("input", ({ value }) => options.onInput(value)),
    error !== undefined && h.p.id(errorId).class("field-error").children(error),
  );
};

const NewUserFormView = UsersPageDef.fragment((h, model: UsersPageModel) => {
  const { fields } = NewUserForm.validate(model.form);

  return h.form
    .class("new-user")
    .attrs({ novalidate: "", "aria-label": "Add a user" })
    .on("submit", UsersPageMessage.SubmittedNewUser())
    .children(
      h.fieldset.disabled(model.saving).children(
        TextField(h, {
          label: "Name",
          name: "displayName",
          type: "text",
          autocomplete: "name",
          field: fields.displayName,
          onInput: (value) => UsersPageMessage.UpdatedDisplayName({ value }),
        }),
        TextField(h, {
          label: "Email",
          name: "email",
          type: "email",
          autocomplete: "email",
          field: fields.email,
          onInput: (value) => UsersPageMessage.UpdatedEmail({ value }),
        }),
        h.button
          .attr("type", "submit")
          .children(model.saving ? "Adding…" : "Add user"),
      ),
      model.failure !== null &&
        h.p
          .class("notice")
          .attr("role", "alert")
          .children(`Could not add the user. ${model.failure}.`),
    );
});

const createdAtFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const UserItem = (h: Html.H<UsersPageMessage>, row: UserRow) => {
  switch (row._tag) {
    case "SavedUser": {
      const { createdAt, displayName, email, id } = row.user;

      return h.li
        .key(id)
        .class("user")
        .children(
          h.span.class("user-name").children(displayName),
          h.span.class("user-email").children(email),
          h.time
            .class("user-status")
            .attr("datetime", createdAt.toISOString())
            .children(createdAtFormat.format(createdAt)),
        );
    }

    case "PendingUser": {
      const { displayName, email } = row.user;

      // One create runs at a time, so one pending row has this email.
      return h.li
        .key(`pending:${email}`)
        .class("user", "user-pending")
        .attr("aria-busy", "true")
        .children(
          h.span.class("user-name").children(displayName),
          h.span.class("user-email").children(email),
          h.span.class("user-status").children("Saving…"),
        );
    }
  }
};

const UserList = (
  h: Html.H<UsersPageMessage>,
  users: AsyncResult.AsyncResult<ReadonlyArray<UserRow>, string>,
) =>
  AsyncResult.matchWithError(users, {
    onInitial: () => h.p.class("status").children("Loading users…"),
    onError: (reason) =>
      h.p
        .class("notice")
        .attr("role", "alert")
        .children(`Could not load users. ${reason}.`),
    onDefect: () =>
      h.p
        .class("notice")
        .attr("role", "alert")
        .children("Could not load users."),
    onSuccess: ({ value: rows, waiting }) => {
      if (rows.length === 0) {
        return h.p.class("status").children("No users yet. Add the first one.");
      }

      return h.ul
        .class("users")
        .attr("aria-busy", String(waiting))
        .children(rows.map((row) => UserItem(h, row)));
    },
  });

const UsersPageNoDeps = UsersPageDef.make({
  init: () => ({ form: emptyForm, saving: false, failure: null }),
  update: {
    UpdatedDisplayName: ($, { value }) =>
      $.evolve({ form: NewUserForm.change("displayName", value) }),
    UpdatedEmail: ($, { value }) =>
      $.evolve({ form: NewUserForm.change("email", value) }),
    SubmittedNewUser: submittedNewUser,
    SucceededCreateUser: ($) => $.evolve({ form: emptyForm, saving: false }),
    FailedCreateUser: ($, { reason }) =>
      $.evolve({ saving: false, failure: reason }),
  },
  view: (h, model) =>
    h.main
      .class("users-page")
      .children(
        h.header.children(
          h.h1("Users"),
          h.p
            .class("lede")
            .children(
              "The list comes from the API. A user you add shows at once, and stays if the API saves it.",
            ),
        ),
        NewUserFormView(h, model),
        UserList(h, h.queries.users),
      ),
});

// The page with the Layers of its query and Command, which need an ApiClient.
const UsersPage = UsersPageNoDeps.pipe(
  Component.provide(Layer.mergeAll(ListUsers.layer, CreateUser.layer)),
);

export {
  CreateUser,
  CreateUserFailed,
  NewUserForm,
  UsersPage,
  UsersPageMessage,
  UsersPageModel,
  UsersPageNoDeps,
};
