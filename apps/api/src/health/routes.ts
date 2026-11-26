import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import {
  Api,
  LivenessResponse,
  ReadinessResponse,
} from "@node-effect/api-contract";
import { DatabaseHealth } from "@node-effect/application";

import { healthFailure } from "../http-errors.ts";

const live = Effect.succeed(LivenessResponse.make({ status: "ok" }));

const ready = Effect.gen(function* () {
  const health = yield* DatabaseHealth;
  yield* health.check;

  return ReadinessResponse.make({ status: "ok", database: "ok" });
}).pipe(Effect.catchTag("DatabaseHealthError", healthFailure));

const HealthHandlers = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers
    .handle("live", () => live)
    .handle("ready", () => ready)
    .handle("readyAlias", () => ready),
);

export { HealthHandlers };
