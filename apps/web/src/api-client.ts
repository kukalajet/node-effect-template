import { Context, Layer, Schema } from "effect";
import { HttpClientError } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { Api } from "@node-effect/api-contract";

// The API, called through the client HttpApi derives from the contract the API
// serves, so every call's payload, success and declared errors are typed.
class ApiClient extends Context.Service<
  ApiClient,
  HttpApiClient.ForApi<typeof Api>
>()("@node-effect/web/ApiClient") {
  // `baseUrl` is where the API answers: the dev server forwards /api to it.
  static readonly layer = (baseUrl: URL) =>
    Layer.effect(ApiClient, HttpApiClient.make(Api, { baseUrl }));
}

// The envelope of every error the API's contract declares
// (packages/api-contract/src/api-schemas.ts), read for its message only.
const PublicError = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});

const isPublicError = Schema.is(PublicError);

// What the page says when a call fails: the API's own message for an error its
// contract declares; otherwise whether the API could not be reached, or
// answered with something the contract does not describe. Like the API's
// messages, these end without a full stop.
const describeApiFailure = (failure: unknown): string => {
  if (isPublicError(failure)) return failure.error.message;

  if (HttpClientError.isHttpClientError(failure)) {
    return "The API could not be reached";
  }

  return "The API sent an answer this page could not read";
};

export { ApiClient, describeApiFailure };
