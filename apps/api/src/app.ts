import { Layer } from "effect";
import { HttpApiBuilder, HttpApiSwagger } from "effect/http-api";

import { Api } from "./api-contract.ts";
import { HealthHandlers } from "./health/routes.ts";
import { UserHandlers } from "./users/routes.ts";

const ApiRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(Layer.mergeAll(HealthHandlers, UserHandlers)),
  ),
  HttpApiSwagger.layer(Api, { path: "/docs" }),
);

export { ApiRoutes };
