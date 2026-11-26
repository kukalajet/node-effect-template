import { Effect } from "effect";
import { type HttpApiError, HttpApiMiddleware } from "effect/http-api";

import {
  BadRequestResponse,
  RequestValidation,
} from "@node-effect/api-contract";

// Request parts the client sent. The other kinds are failures to encode the
// server's own response, which stay internal errors.
const clientInputKinds = new Set<HttpApiError.HttpApiSchemaError["kind"]>([
  "Params",
  "Query",
  "Headers",
  "Payload",
]);

const RequestValidationLive = HttpApiMiddleware.layerSchemaErrorTransform(
  RequestValidation,
  (error) => {
    if (clientInputKinds.has(error.kind)) {
      return Effect.fail(BadRequestResponse.body);
    }

    return Effect.fail(error);
  },
);

export { RequestValidationLive };
