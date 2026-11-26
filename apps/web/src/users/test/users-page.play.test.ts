import { HtmlLocator, HtmlPlay } from "@effect/ui/html/testing";
import { Locator, TestHost } from "@effect/ui/testing";
import { describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
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

// How long it takes to answer a list in the tests that hold the list back, so
// they can look at the page between a create's answer and the refetched list.
const listLatency = "2 seconds";

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

// The users endpoints over a list held in memory, newest first, as the API
// answers them: 409 for an email in use. `failList` answers every list with
// the API's 500 instead, and `slowList` answers it after `listLatency`.
const fakeApi = (
  seed: ReadonlyArray<SentUser>,
  options: { readonly failList?: boolean; readonly slowList?: boolean } = {},
) => {
  const users = [...seed];

  return HttpClient.make((request, url) => {
    if (url.pathname !== "/users") {
      return Effect.die(new Error(`Unexpected ${request.method} ${url.href}`));
    }

    if (request.method === "GET") {
      const list =
        options.failList === true
          ? jsonResponse(request, 500, DatabaseErrorResponse.body)
          : jsonResponse(request, 200, { users: [...users] });

      return options.slowList === true
        ? Effect.as(Effect.sleep(listLatency), list)
        : Effect.succeed(list);
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

const testLayer = (api: HttpClient.HttpClient) =>
  Layer.mergeAll(
    TestHost.layer(),
    ApiClient.layer(new URL("http://api.test")).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, api)),
    ),
  );

const nameField = HtmlLocator.label("Name");
const emailField = HtmlLocator.label("Email");
const addUser = HtmlLocator.role("button", { name: "Add user" });
const userRows = HtmlLocator.role("listitem");
const saving = Locator.text("Saving…", { exact: true });

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

        // The API has not answered: the row is the page's own, trimmed.
        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(saving).toExist();

        yield* play
          .expect(Locator.text("Ada Lovelace", { exact: true }))
          .toExist();

        yield* play
          .expect(HtmlLocator.role("button", { name: "Adding…" }))
          .toExist();

        yield* TestClock.adjust(createLatency);

        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(saving).toBeAbsent();

        yield* play
          .expect(Locator.text("Ada Lovelace", { exact: true }))
          .toExist();

        yield* play.expect(nameField).toHaveValue("");
        yield* play.expect(emailField).toHaveValue("");
      }).pipe(Effect.provide(testLayer(fakeApi([grace])))),
  );

  it.effect(
    "keeps a created user pending until the list is fetched again",
    () =>
      Effect.gen(function* () {
        const play = yield* HtmlPlay.make(UsersPage, {});

        yield* TestClock.adjust(listLatency);
        yield* play.type(nameField, "Ada Lovelace");
        yield* play.type(emailField, "ada@example.com");
        yield* play.click(addUser);
        yield* TestClock.adjust(createLatency);

        // The API created the user; the list it will be read from is on its way.
        yield* play.expect(saving).toExist();

        yield* play
          .expect(HtmlLocator.role("button", { name: "Adding…" }))
          .toExist();

        yield* TestClock.adjust(listLatency);

        yield* play.expect(saving).toBeAbsent();
        yield* play.expect(userRows).toHaveCount(2);
        yield* play.expect(nameField).toHaveValue("");
      }).pipe(Effect.provide(testLayer(fakeApi([grace], { slowList: true })))),
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
          .expect(HtmlLocator.role("alert"))
          .toHaveText(
            "Could not add the user. A user with this email already exists.",
          );

        // The form keeps what was typed, so the email can be corrected.
        yield* play.expect(emailField).toHaveValue("ada@example.com");
        yield* play.expect(addUser).toExist();

        yield* TestClock.adjust(listLatency);
        yield* play.expect(userRows).toHaveCount(1);
      }).pipe(Effect.provide(testLayer(fakeApi([ada], { slowList: true })))),
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

      yield* play.expect(userRows).toHaveCount(1);
      yield* play.expect(saving).toBeAbsent();
    }).pipe(Effect.provide(testLayer(fakeApi([grace])))),
  );

  it.effect("says why the list could not be loaded", () =>
    Effect.gen(function* () {
      const play = yield* HtmlPlay.make(UsersPage, {});

      yield* play
        .expect(HtmlLocator.role("alert"))
        .toHaveText(
          "Could not load users. The database operation could not be completed.",
        );
    }).pipe(Effect.provide(testLayer(fakeApi([], { failList: true })))),
  );
});
