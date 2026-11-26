import { HttpApiMiddleware } from "effect/http-api";

import { BadRequestResponse } from "./api-schemas.ts";

// A group behind this middleware answers a schema error in a request's path,
// query, headers or payload with 400 INVALID_REQUEST, which every endpoint of
// the group therefore declares. The API implements it; a client needs nothing.
class RequestValidation extends HttpApiMiddleware.Service<RequestValidation>()(
  "@node-effect/api-contract/RequestValidation",
  { error: BadRequestResponse.schema },
) {}

export { RequestValidation };
