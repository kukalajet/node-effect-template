import { Context, Layer, Schema } from "effect";
import { HttpClientError } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { Api, PublicErrorEnvelope } from "@node-effect/api-contract";

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

const isPublicError = Schema.is(PublicErrorEnvelope);

// From 502 up, the answer comes from a proxy in front of the API that could not
// reach it: the dev server's proxy answers 502, and Cloudflare 52x or 530. No
// route the page calls declares a status that high.
const firstUnreachableStatus = 502;

// A call that got no answer the contract describes: no answer at all, an error
// status the contract does not declare for the call, or a body that is not
// what the contract says it is.
const describeHttpFailure = (failure: HttpClientError.HttpClientError) => {
  const status = failure.response?.status;

  if (status === undefined || status >= firstUnreachableStatus) {
    return "The API could not be reached";
  }

  if (status >= 400) return `The API answered with status ${status}`;

  return "The API sent an answer this page could not read";
};

// What the page says when a call fails: the API's own message for an error its
// contract declares, and otherwise what was wrong with the answer. Like the
// API's messages, these end without a full stop.
const describeApiFailure = (failure: unknown): string => {
  if (isPublicError(failure)) return failure.error.message;

  if (HttpClientError.isHttpClientError(failure)) {
    return describeHttpFailure(failure);
  }

  return "The API sent an answer this page could not read";
};

export { ApiClient, describeApiFailure };
