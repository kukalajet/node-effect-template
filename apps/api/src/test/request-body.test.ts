import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";

import { RequestValidation } from "../api-middleware.ts";
import { PayloadTooLargeResponse } from "../api-schemas.ts";
import { jsonBodyHandler, withJsonBodyLimit } from "../request-body.ts";

const NoteSchema = Schema.Struct({ text: Schema.String });

// Answers with the body it was given.
const echo = <A>(body: A) => Effect.succeed(body);

// The handler for any endpoint, whatever its payload.
const echoBody = jsonBodyHandler((body: unknown) => echo(body));

// A complete JSON endpoint of the test's own: payload, limit, the 413 among
// its errors, behind RequestValidation.
const NotesApi = HttpApi.make("notes").add(
  HttpApiGroup.make("notes")
    .add(
      HttpApiEndpoint.post("create", "/notes", {
        payload: NoteSchema,
        success: NoteSchema,
        error: PayloadTooLargeResponse.schema,
      }).pipe(withJsonBodyLimit(1024)),
    )
    .middleware(RequestValidation),
);

// A small, valid JSON POST, as the router hands it to a raw handler.
const notePost = () =>
  HttpServerRequest.fromWeb(
    new Request("http://localhost/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    }),
  );

// Reads the body above as `endpoint`'s raw handler does.
const readBody = (endpoint: Parameters<typeof echoBody>[0]["endpoint"]) =>
  echoBody({ endpoint }).pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, notePost()),
    Effect.exit,
  );

// The users route tests read real bodies through the users contract; these
// cover the limit this module reads from an endpoint, and the contracts that
// leave out what it reads from them.
describe("jsonBodyHandler", () => {
  it.effect("decodes a body within the endpoint's limit", () =>
    Effect.gen(function* () {
      const endpoint = HttpApiEndpoint.post("createNote", "/notes", {
        payload: NoteSchema,
      }).pipe(withJsonBodyLimit(1024));

      const exit = yield* readBody(endpoint);

      assert.deepStrictEqual(exit, Exit.succeed({ text: "hello" }));
    }),
  );

  it.effect("fails with the 413 body for a body over that limit", () =>
    Effect.gen(function* () {
      const endpoint = HttpApiEndpoint.post("createNote", "/notes", {
        payload: NoteSchema,
      }).pipe(withJsonBodyLimit(8));

      const exit = yield* readBody(endpoint);

      assert.deepStrictEqual(exit, Exit.fail(PayloadTooLargeResponse.body));
    }),
  );

  it.effect("dies naming an endpoint whose contract sets no limit", () =>
    Effect.gen(function* () {
      const endpoint = HttpApiEndpoint.post("createNote", "/notes", {
        payload: NoteSchema,
      });

      const exit = yield* readBody(endpoint);

      assert(Exit.isFailure(exit));
      assert.isTrue(exit.cause.reasons.every(Cause.isDieReason));

      assert.match(
        String(Cause.squash(exit.cause)),
        /createNote declares no JsonBodyLimit/,
      );
    }),
  );

  it.effect("dies naming an endpoint that declares no JSON payload", () =>
    Effect.gen(function* () {
      const endpoint = HttpApiEndpoint.post("ping", "/ping").pipe(
        withJsonBodyLimit(1024),
      );

      const exit = yield* readBody(endpoint);

      assert(Exit.isFailure(exit));
      assert.isTrue(exit.cause.reasons.every(Cause.isDieReason));

      assert.match(
        String(Cause.squash(exit.cause)),
        /ping declares no JSON payload/,
      );
    }),
  );

  it("registers with handleRaw, and not with handle", () => {
    const handlers = HttpApiBuilder.group(NotesApi, "notes", (notes) => {
      // @ts-expect-error: handle reads the body first, without the limit
      notes.handle("create", jsonBodyHandler(echo));

      return notes.handleRaw("create", jsonBodyHandler(echo));
    });

    assert.isTrue(Layer.isLayer(handlers));
  });
});
