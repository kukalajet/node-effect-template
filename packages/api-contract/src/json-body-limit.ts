import { Context } from "effect";

// The most bytes an endpoint's JSON body may have. `withJsonBodyLimit` sets it
// on the endpoint's contract, and the API's body reader reads it from there.
class JsonBodyLimit extends Context.Service<JsonBodyLimit, number>()(
  "@node-effect/api-contract/JsonBodyLimit",
) {}

// Sets the body limit on a JSON endpoint's contract: `maxBytes` is what the
// API's `jsonBodyHandler` reads there, beside the PayloadTooLargeResponse and
// UnsupportedMediaTypeResponse the endpoint must declare.
const withJsonBodyLimit =
  (maxBytes: number) =>
  <
    Endpoint extends {
      readonly annotate: (key: typeof JsonBodyLimit, value: number) => Endpoint;
    },
  >(
    endpoint: Endpoint,
  ) =>
    endpoint.annotate(JsonBodyLimit, maxBytes);

export { JsonBodyLimit, withJsonBodyLimit };
