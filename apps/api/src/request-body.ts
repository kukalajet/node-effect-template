import { Effect, Schema, type SchemaAST, Stream } from "effect";
import { HttpServerRequest } from "effect/http";

import { BadRequestResponse, PayloadTooLargeResponse } from "./api-schemas.ts";

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

// Reads a JSON body of at most `maxBytes` and decodes it with `schema`,
// rejecting unknown fields unless `options` set `onExcessProperty`. Fails with
// the public 400 or 413 body, so the endpoint must declare
// PayloadTooLargeResponse and sit behind RequestValidation, and its handler
// must be registered with `handleRaw`.
const jsonBody = <A, RD>(
  schema: Schema.ConstraintDecoder<A, RD>,
  maxBytes: number,
  options?: SchemaAST.ParseOptions,
) =>
  collectBody(maxBytes).pipe(
    Effect.map(joinBodyChunks),
    Effect.map((bytes) => textDecoder.decode(bytes)),
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema), {
        onExcessProperty: "error",
        ...options,
      }),
    ),
    Effect.catchTags({
      HttpServerError: () => Effect.fail(BadRequestResponse.body),
      SchemaError: () => Effect.fail(BadRequestResponse.body),
    }),
  );

export { jsonBody };
