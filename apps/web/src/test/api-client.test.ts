import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import {
  DatabaseErrorResponse,
  InternalErrorResponse,
  NotFoundResponse,
} from "@node-effect/api-contract";

import { ApiClient, describeApiFailure } from "../api-client.ts";

type Respond = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  HttpClientError.HttpClientError
>;

// An answer from the API, or from something in front of it.
const answer =
  (status: number, body: string, contentType: string): Respond =>
  (request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(body, {
          status,
          headers: { "content-type": contentType },
        }),
      ),
    );

const json = (status: number, body: unknown) =>
  answer(status, JSON.stringify(body), "application/json");

const noAnswer: Respond = (request) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request }),
    }),
  );

// What the page says when listing users gets `respond`'s answer. Where the
// failure has more than one part, the page shows the first, as here.
const describeListFailure = (respond: Respond) =>
  Effect.gen(function* () {
    const api = yield* ApiClient;

    return yield* api.users
      .list({ query: { limit: 50 } })
      .pipe(Effect.mapError(describeApiFailure), Effect.flip);
  }).pipe(
    Effect.provide(
      ApiClient.layer(new URL("http://api.test")).pipe(
        Layer.provide(
          Layer.succeed(HttpClient.HttpClient, HttpClient.make(respond)),
        ),
      ),
    ),
  );

const cases: ReadonlyArray<{
  readonly name: string;
  readonly respond: Respond;
  readonly says: string;
}> = [
  {
    name: "gives the API's own message for an error the call declares",
    respond: json(500, DatabaseErrorResponse.body),
    says: "The database operation could not be completed",
  },
  {
    name: "names a status the call does not declare",
    respond: json(404, NotFoundResponse.body),
    says: "The API answered with status 404",
  },
  {
    name: "names a declared status whose body is another error",
    respond: json(500, InternalErrorResponse.body),
    says: "The API answered with status 500",
  },
  {
    name: "names 400, the lowest error status",
    respond: answer(400, "<html>Bad Request</html>", "text/html"),
    says: "The API answered with status 400",
  },
  {
    name: "names 501, below the statuses a proxy answers for an API it cannot reach",
    respond: answer(501, "", "text/plain"),
    says: "The API answered with status 501",
  },
  {
    name: "says the API could not be reached when the dev server's proxy answers",
    respond: answer(502, "", "text/plain"),
    says: "The API could not be reached",
  },
  {
    name: "says the API could not be reached when a proxy times out waiting for it",
    respond: answer(504, "", "text/plain"),
    says: "The API could not be reached",
  },
  {
    name: "says the API could not be reached when Cloudflare answers",
    respond: answer(530, "<html>origin unreachable</html>", "text/html"),
    says: "The API could not be reached",
  },
  {
    name: "says the API could not be reached when no answer comes",
    respond: noAnswer,
    says: "The API could not be reached",
  },
  {
    name: "says a success it cannot decode could not be read",
    respond: json(200, { people: [] }),
    says: "The API sent an answer this page could not read",
  },
  {
    name: "says a page served in the API's place could not be read",
    respond: answer(200, "<!doctype html><title>Users</title>", "text/html"),
    says: "The API sent an answer this page could not read",
  },
  {
    // A redirect that fetch passes on, since it has no Location to follow.
    name: "says a status below 400 the call does not declare could not be read",
    respond: answer(301, "<html>Moved</html>", "text/html"),
    says: "The API sent an answer this page could not read",
  },
];

describe("describeApiFailure", () => {
  for (const { name, respond, says } of cases) {
    it.effect(name, () =>
      Effect.map(describeListFailure(respond), (said) =>
        assert.strictEqual(said, says),
      ),
    );
  }
});
