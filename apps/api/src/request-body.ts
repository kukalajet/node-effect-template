import { Context, Effect, Option, Schema, Stream } from "effect";
import { HttpServerRequest } from "effect/http";
import type { HttpApiEndpoint } from "effect/http-api";

import { BadRequestResponse, PayloadTooLargeResponse } from "./api-schemas.ts";

// The most bytes an endpoint's JSON body may have. Its contract sets it with
// `.annotate(JsonBodyLimit, bytes)`, beside the PayloadTooLargeResponse that
// the endpoint must declare.
class JsonBodyLimit extends Context.Service<JsonBodyLimit, number>()(
  "@node-effect/api/JsonBodyLimit",
) {}

// What jsonBody reads from an endpoint: its payloads and their types, its
// identifier and its annotations.
type BodyEndpoint = HttpApiEndpoint.ConstraintRequest & {
  readonly payload: HttpApiEndpoint.PayloadMap;
  readonly annotations: Context.Context<never>;
};

// The schema of the JSON payload an endpoint's contract declares.
type JsonPayload<Endpoint> =
  HttpApiEndpoint.Payload<Endpoint> extends infer S extends Schema.Top
    ? S
    : never;

type CollectedBody = {
  readonly chunks: Array<Uint8Array>;
  readonly byteLength: number;
};

// Stops reading as soon as the body passes `maxBytes`, whatever the
// Content-Length header claims.
const collectBody = (maxBytes: number) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    return yield* request.stream.pipe(
      Stream.runFoldEffect(
        (): CollectedBody => ({ chunks: [], byteLength: 0 }),
        (body, chunk) => {
          const byteLength = body.byteLength + chunk.byteLength;
          if (byteLength > maxBytes) {
            return Effect.fail(PayloadTooLargeResponse.body);
          }

          body.chunks.push(chunk);

          return Effect.succeed({ chunks: body.chunks, byteLength });
        },
      ),
    );
  });

const joinBodyChunks = (body: CollectedBody): Uint8Array => {
  const bytes = new Uint8Array(body.byteLength);
  let offset = 0;

  for (const chunk of body.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

const textDecoder = new TextDecoder();

// The JSON payload's schema among the payloads `endpoint` declares.
const jsonPayloadSchema = (endpoint: BodyEndpoint) => {
  for (const payload of endpoint.payload.values()) {
    if (payload.encoding._tag === "Json" && "schemas" in payload) {
      return payload.schemas[0];
    }
  }

  return undefined;
};

// Reads `endpoint`'s JSON body: at most the JsonBodyLimit its contract sets,
// decoded with the payload schema the contract declares, unknown fields
// rejected. Fails with the public 400 or 413 body, so the endpoint must sit
// behind RequestValidation, and its handler must be registered with
// `handleRaw`, which leaves the body unread. A contract without a JSON payload
// or a limit is a mistake in the code, so reading its body dies, naming the
// endpoint.
const jsonBody = <Endpoint extends BodyEndpoint>(endpoint: Endpoint) => {
  const schema = jsonPayloadSchema(endpoint);
  const maxBytes = Context.getOption(endpoint.annotations, JsonBodyLimit);

  if (schema === undefined) {
    return Effect.die(
      new Error(`Endpoint ${endpoint.identifier} declares no JSON payload`),
    );
  }

  if (Option.isNone(maxBytes)) {
    return Effect.die(
      new Error(`Endpoint ${endpoint.identifier} declares no JsonBodyLimit`),
    );
  }

  const decodeBody = Schema.decodeUnknownEffect(Schema.fromJsonString(schema), {
    onExcessProperty: "error",
  });

  // SAFETY: `schema` is the JSON payload `endpoint` declares, so it decodes to
  // that payload's type and needs its decoding services; the endpoint's
  // payload map only forgets which schema it holds.
  return collectBody(maxBytes.value).pipe(
    Effect.map(joinBodyChunks),
    Effect.map((bytes) => textDecoder.decode(bytes)),
    Effect.flatMap(decodeBody),
    Effect.catchTags({
      HttpServerError: () => Effect.fail(BadRequestResponse.body),
      SchemaError: () => Effect.fail(BadRequestResponse.body),
    }),
  ) as Effect.Effect<
    JsonPayload<Endpoint>["Type"],
    typeof BadRequestResponse.body | typeof PayloadTooLargeResponse.body,
    | HttpServerRequest.HttpServerRequest
    | JsonPayload<Endpoint>["DecodingServices"]
  >;
};

export { jsonBody, JsonBodyLimit };
