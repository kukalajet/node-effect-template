import { Html } from "@effect/ui/html";
import { HtmlLocator, HtmlPlay } from "@effect/ui/html/testing";
import { Locator, TestHost } from "@effect/ui/testing";
import { assert, describe, it } from "@effect/vitest";
import { Context, type Duration, Effect, Layer, Schema } from "effect";
import {
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { TestClock } from "effect/testing";

import {
  DatabaseErrorResponse,
  UserAlreadyExistsResponse,
} from "@node-effect/api-contract";
import { CreateUserSchema } from "@node-effect/domain";

import { ApiClient } from "../../api-client.ts";
import { UsersPage } from "../users-page.ts";

// A user as the API sends it, its creation time encoded.
type SentUser = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
};

const grace: SentUser = {
  id: "7f0c1a52-3c8e-4c39-9a52-6a3a0f5e1b2c",
  email: "grace@example.com",
  displayName: "Grace Hopper",
  createdAt: "2026-11-01T09:00:00.000Z",
};

const ada: SentUser = {
  id: "0b6e7a8c-1d2f-4e3a-8b4c-5d6e7f8a9b0c",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  createdAt: "2026-11-02T09:00:00.000Z",
};

// How long the fake API takes to answer a create, so a test can look at the
// page before the answer arrives.
const createLatency = "1 second";

// How long a list takes in the tests that hold it back, so they can look at the
// page between a create's answer and the list fetched after it.
const listLatency = "2 seconds";

// How long the page waits for that list before it takes the create's success
// (`Command.afterRefetch` in users-page.ts), and a list that takes longer.
const refetchBudget = "5 seconds";
const slowListLatency = "8 seconds";

const jsonResponse = (
  request: HttpClientRequest.HttpClientRequest,
  status: number,
  body: unknown,
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const requestBody = (request: HttpClientRequest.HttpClientRequest) => {
  if (request.body._tag !== "Uint8Array") {
    throw new Error(`Expected a JSON body, got ${request.body._tag}`);
  }

  return JSON.parse(new TextDecoder().decode(request.body.body));
};

type FakeApiOptions = {
  // How long each list takes to answer. Without it a list answers at once.
  readonly listLatency?: Duration.Input;
  // How many lists succeed before every later one answers the API's 500.
  readonly listsBeforeFailure?: number;
};

// The users endpoints over a list held in memory, newest first, as the API
// answers them: 409 for an email in use.
const fakeApi = (
  seed: ReadonlyArray<SentUser>,
  options: FakeApiOptions = {},
) => {
  const users = [...seed];
  let listsAnswered = 0;

  const nextListFails = () =>
    options.listsBeforeFailure !== undefined &&
    listsAnswered >= options.listsBeforeFailure;

  return HttpClient.make((request, url) => {
    if (url.pathname !== "/users") {
      return Effect.die(new Error(`Unexpected ${request.method} ${url.href}`));
    }

    if (request.method === "GET") {
      const list = nextListFails()
        ? jsonResponse(request, 500, DatabaseErrorResponse.body)
        : jsonResponse(request, 200, { users: [...users] });

      listsAnswered += 1;

      if (options.listLatency === undefined) return Effect.succeed(list);

      return Effect.as(Effect.sleep(options.listLatency), list);
    }

    return Effect.gen(function* () {
      yield* Effect.sleep(createLatency);

      const input = Schema.decodeUnknownSync(CreateUserSchema)(
        requestBody(request),
      );

      if (users.some((user) => user.email === input.email)) {
        return jsonResponse(request, 409, UserAlreadyExistsResponse.body);
      }

      const created: SentUser = {
        ...input,
        id: `6f1d2c3b-4a5e-4f60-8a7b-${String(users.length).padStart(12, "0")}`,
        createdAt: "2026-11-26T10:00:00.000Z",
      };

      users.unshift(created);

      return jsonResponse(request, 201, created);
    });
  });
};

// The names of the fields the page focused, oldest first.
class FocusedFields extends Context.Service<
  FocusedFields,
  ReadonlyArray<string>
>()("@node-effect/web/test/FocusedFields") {}

const unusedOperation = (): never => {
  throw new Error("The users page uses no other element operation");
};

// A form field on TestHost, which keeps an element's attributes in `attrs`.
const decodeField = Schema.decodeUnknownSync(
  Schema.Struct({ attrs: Schema.Struct({ name: Schema.String }) }),
);

// The element operations behind HtmlCommand, which a test on TestHost fakes.
// The page only focuses fields, so `focus` records each field's name.
const recordingHtmlHost = (focused: Array<string>) =>
  Layer.succeed(Html.Host, {
    focus: (element) => {
      focused.push(decodeField(element).attrs.name);
    },
    blur: unusedOperation,
    scrollIntoView: unusedOperation,
    measure: unusedOperation,
    select: unusedOperation,
    requestSubmit: unusedOperation,
    showPicker: unusedOperation,
  });

const testLayer = (api: HttpClient.HttpClient) => {
  const focused: Array<string> = [];

  return Layer.mergeAll(
    TestHost.layer(),
    recordingHtmlHost(focused),
    Layer.succeed(FocusedFields, focused),
    ApiClient.layer(new URL("http://api.test")).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, api)),
    ),
  );
};

const nameField = HtmlLocator.label("Name");
const emailField = HtmlLocator.label("Email");
const addUser = HtmlLocator.role("button", { name: "Add user" });
const adding = HtmlLocator.role("button", { name: "Adding…" });
const alert = HtmlLocator.role("alert");
const userRows = HtmlLocator.role("listitem");
const saving = Locator.text("Saving…", { exact: true });

// Where the API's newest-first order puts a new user.
const firstRow: Locator.Locator = {
  description: "the first list item",
  all: (root) => userRows.all(root).slice(0, 1),
};

describe("UsersPage", () => {
  it.effect(
    "shows a new user before the API answers, then the saved user",
    () =>
      Effect.gen(function* () {
        const play = yield* HtmlPlay.make(UsersPage, {});

        yield* play.expect(Locator.text("Grace Hopper")).toExist();

        yield* play.type(nameField, " Ada Lovelace ");
        yield* play.type(emailField, "ada@example.com");
        yield* play.click(addUser);

        // The API has not answered: the row on top is the page's own, trimmed,
        // and the form waits.
        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(Locator.inside(firstRow, saving)).toExist();

        yield* play
          .expect(Locator.text("Ada Lovelace", { exact: true }))
          .toExist();

        yield* play.expect(adding).toExist();
        yield* play.expect(nameField).toBeDisabled();

        yield* TestClock.adjust(createLatency);

        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(saving).toBeAbsent();

        yield* play
          .expect(Locator.inside(firstRow, Locator.text("Ada Lovelace")))
          .toExist();

        yield* play.expect(nameField).toHaveValue("");
        yield* play.expect(nameField).toBeDisabled(false);
        yield* play.expect(emailField).toHaveValue("");

        // Focus is back in the form, where the next user's name goes.
        assert.deepStrictEqual(yield* FocusedFields, ["displayName"]);
      }).pipe(Effect.provide(testLayer(fakeApi([grace])))),
  );

  it.effect(
    "keeps a created user pending until the list is fetched again",
    () =>
      Effect.gen(function* () {
        const play = yield* HtmlPlay.make(UsersPage, {});

        yield* play.expect(Locator.text("Loading users…")).toExist();

        yield* TestClock.adjust(listLatency);
        yield* play.type(nameField, "Ada Lovelace");
        yield* play.type(emailField, "ada@example.com");
        yield* play.click(addUser);
        yield* TestClock.adjust(createLatency);

        // The API created the user; the list it will be read from is on its way.
        yield* play.expect(Locator.inside(firstRow, saving)).toExist();
        yield* play.expect(adding).toExist();

        yield* TestClock.adjust(listLatency);

        yield* play.expect(saving).toBeAbsent();
        yield* play.expect(userRows).toHaveCount(2);

        yield* play
          .expect(Locator.inside(firstRow, Locator.text("Ada Lovelace")))
          .toExist();

        yield* play.expect(nameField).toHaveValue("");
      }).pipe(Effect.provide(testLayer(fakeApi([grace], { listLatency })))),
  );

  it.effect(
    "takes a refused user off the list as soon as the API answers",
    () =>
      Effect.gen(function* () {
        const play = yield* HtmlPlay.make(UsersPage, {});

        yield* TestClock.adjust(listLatency);
        yield* play.expect(userRows).toHaveCount(1);

        yield* play.type(nameField, "Ada Again");
        yield* play.type(emailField, "ada@example.com");
        yield* play.click(addUser);

        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(Locator.text("Ada Again")).toExist();

        // The API answers 409; the list it sends next is still on its way.
        yield* TestClock.adjust(createLatency);

        yield* play.expect(userRows).toHaveCount(1);
        yield* play.expect(Locator.text("Ada Again")).toBeAbsent();

        yield* play
          .expect(alert)
          .toHaveText(
            "Could not add the user. A user with this email already exists.",
          );

        // The form keeps what was typed, and focus goes to the email to
        // correct.
        yield* play.expect(emailField).toHaveValue("ada@example.com");
        yield* play.expect(addUser).toExist();

        assert.deepStrictEqual(yield* FocusedFields, ["email"]);

        yield* TestClock.adjust(listLatency);
        yield* play.expect(userRows).toHaveCount(1);

        // Sent again with another email, the user is created and the notice
        // goes.
        yield* play.type(emailField, "ada.again@example.com");
        yield* play.click(addUser);
        yield* play.expect(alert).toBeAbsent();
        yield* TestClock.adjust(createLatency);
        yield* play.expect(adding).toExist();
        yield* TestClock.adjust(listLatency);
        yield* play.expect(saving).toBeAbsent();
        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(alert).toBeAbsent();

        assert.deepStrictEqual(yield* FocusedFields, ["email", "displayName"]);
      }).pipe(Effect.provide(testLayer(fakeApi([ada], { listLatency })))),
  );

  it.effect(
    "keeps one pending row when an email is sent again before the list comes",
    () =>
      Effect.gen(function* () {
        const play = yield* HtmlPlay.make(UsersPage, {});

        yield* TestClock.adjust(slowListLatency);
        yield* play.type(nameField, "Ada Lovelace");
        yield* play.type(emailField, "ada@example.com");
        yield* play.click(addUser);
        yield* TestClock.adjust(createLatency);

        // The API created Ada. The list fetched after it is slower than the
        // page waits for it, so the form comes back while her row is pending.
        yield* play.expect(adding).toExist();
        yield* TestClock.adjust(refetchBudget);
        yield* play.expect(nameField).toHaveValue("");
        yield* play.expect(saving).toExist();

        // The same email again takes that row's place, and the API refuses it.
        yield* play.type(nameField, "Ada Again");
        yield* play.type(emailField, "ada@example.com");
        yield* play.click(addUser);

        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(Locator.text("Ada Again")).toExist();

        yield* TestClock.adjust(createLatency);

        yield* play
          .expect(alert)
          .toHaveText(
            "Could not add the user. A user with this email already exists.",
          );

        yield* play.expect(Locator.text("Ada Again")).toBeAbsent();
        yield* play.expect(Locator.inside(firstRow, saving)).toExist();

        yield* TestClock.adjust(slowListLatency);

        yield* play.expect(saving).toBeAbsent();
        yield* play.expect(userRows).toHaveCount(2);

        yield* play
          .expect(Locator.inside(firstRow, Locator.text("Ada Lovelace")))
          .toExist();
      }).pipe(
        Effect.provide(
          testLayer(fakeApi([grace], { listLatency: slowListLatency })),
        ),
      ),
  );

  it.effect("adds the first user to an empty list", () =>
    Effect.gen(function* () {
      const play = yield* HtmlPlay.make(UsersPage, {});

      yield* play
        .expect(Locator.text("No users yet. Add the first one."))
        .toExist();

      yield* play.type(nameField, "Ada Lovelace");
      yield* play.type(emailField, "ada@example.com");
      yield* play.click(addUser);

      yield* play.expect(userRows).toHaveCount(1);
      yield* play.expect(saving).toExist();

      yield* TestClock.adjust(createLatency);

      yield* play.expect(userRows).toHaveCount(1);
      yield* play.expect(saving).toBeAbsent();
    }).pipe(Effect.provide(testLayer(fakeApi([])))),
  );

  it.effect("asks the API for nothing while the form is invalid", () =>
    Effect.gen(function* () {
      const play = yield* HtmlPlay.make(UsersPage, {});

      yield* play.type(emailField, "not an email");
      yield* play.click(addUser);

      yield* play.expect(Locator.text("Enter a name.")).toExist();

      yield* play
        .expect(Locator.text("Enter an email address such as ada@example.com."))
        .toExist();

      // The form stays usable, and nothing is on its way to the API.
      yield* play.expect(addUser).toBeDisabled(false);
      yield* play.expect(userRows).toHaveCount(1);

      assert.deepStrictEqual(play.root.pending(), []);
    }).pipe(Effect.provide(testLayer(fakeApi([grace])))),
  );

  it.effect("takes a name of spaces as no name", () =>
    Effect.gen(function* () {
      const play = yield* HtmlPlay.make(UsersPage, {});

      yield* play.type(nameField, "   ");
      yield* play.type(emailField, "ada@example.com");
      yield* play.click(addUser);

      yield* play.expect(Locator.text("Enter a name.")).toExist();

      assert.deepStrictEqual(play.root.pending(), []);
    }).pipe(Effect.provide(testLayer(fakeApi([grace])))),
  );

  it.effect("says why the list could not be loaded", () =>
    Effect.gen(function* () {
      const play = yield* HtmlPlay.make(UsersPage, {});

      yield* play
        .expect(alert)
        .toHaveText(
          "Could not load users. The database operation could not be completed.",
        );
    }).pipe(Effect.provide(testLayer(fakeApi([], { listsBeforeFailure: 0 })))),
  );

  it.effect("keeps the list it had when fetching it again fails", () =>
    Effect.gen(function* () {
      const play = yield* HtmlPlay.make(UsersPage, {});

      yield* play.expect(Locator.text("Grace Hopper")).toExist();

      yield* play.type(nameField, "Ada Lovelace");
      yield* play.type(emailField, "ada@example.com");
      yield* play.click(addUser);
      yield* TestClock.adjust(createLatency);

      // The API created Ada, but the list fetched after it failed.
      yield* play
        .expect(alert)
        .toHaveText(
          "Could not load users. The database operation could not be completed.",
        );

      yield* play.expect(Locator.text("Grace Hopper")).toExist();
      yield* play.expect(nameField).toHaveValue("");
    }).pipe(
      Effect.provide(testLayer(fakeApi([grace], { listsBeforeFailure: 1 }))),
    ),
  );
});
