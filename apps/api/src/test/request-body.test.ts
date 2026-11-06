import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiEndpoint } from "effect/http-api";

import { jsonBody, JsonBodyLimit } from "../request-body.ts";

const NoteSchema = Schema.Struct({ text: Schema.String });

// A small, valid JSON POST, as the router hands it to a raw handler.
const notePost = () =>
  HttpServerRequest.fromWeb(
    new Request("http://localhost/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    }),
  );

// The users route tests read real bodies through the users contract; these
// cover contracts that leave out what jsonBody reads from them.
describe("jsonBody", () => {
  it.effect(
    "dies naming an endpoint whose contract sets no JsonBodyLimit",
    () =>
      Effect.gen(function* () {
        const endpoint = HttpApiEndpoint.post("createNote", "/notes", {
          payload: NoteSchema,
        });

        const exit = yield* jsonBody(endpoint).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            notePost(),
          ),
          Effect.exit,
        );

        assert(Exit.isFailure(exit));
        assert.isTrue(exit.cause.reasons.every(Cause.isDieReason));

        assert.match(
          String(Cause.squash(exit.cause)),
          /createNote declares no JsonBodyLimit/,
        );
      }),
  );

  it.effect(
    "dies naming an endpoint whose contract declares no JSON payload",
    () =>
      Effect.gen(function* () {
        const endpoint = HttpApiEndpoint.post("ping", "/ping").annotate(
          JsonBodyLimit,
          1024,
        );

        const exit = yield* jsonBody(endpoint).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            notePost(),
          ),
          Effect.exit,
        );

        assert(Exit.isFailure(exit));
        assert.isTrue(exit.cause.reasons.every(Cause.isDieReason));

        assert.match(
          String(Cause.squash(exit.cause)),
          /ping declares no JSON payload/,
        );
      }),
  );
});
