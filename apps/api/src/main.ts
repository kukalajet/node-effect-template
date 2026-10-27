import { createServer } from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer, Logger } from "effect";
import { HttpRouter } from "effect/http";

import { AppConfig } from "@node-effect/config";

import { ApiRoutes } from "./app.ts";
import { RequestServicesLive } from "./request-services-live.ts";

const HttpServerLive = Layer.unwrap(
  AppConfig.pipe(
    Effect.map((config) =>
      NodeHttpServer.layer(createServer, {
        host: config.apiHost,
        port: config.apiPort,
        gracefulShutdownTimeout: "10 seconds",
      }),
    ),
  ),
);

const ServerLive = HttpRouter.serve(
  ApiRoutes.pipe(HttpRouter.provideRequest(RequestServicesLive)),
).pipe(Layer.provide(HttpServerLive), Layer.provide(AppConfig.layer));

const main = Layer.launch(ServerLive).pipe(
  Effect.provide(Logger.layer([Logger.consoleJson])),
);

NodeRuntime.runMain(main);
