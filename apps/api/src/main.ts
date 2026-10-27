import { createServer } from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer, Logger } from "effect";
import { HttpRouter } from "effect/http";

import { AppConfig } from "@node-effect/config";

import { ApiRoutes } from "./app.ts";
import { RequestServicesLive } from "./request-services-live.ts";

// cloudflared keeps an idle connection to the API for 90 s before dropping it
// (its originRequest.keepAliveTimeout default). Node closes idle sockets after
// 5 s, so cloudflared could send a request on a socket Node is closing and
// answer it with a 502. Waiting longer leaves closing idle sockets to
// cloudflared. headersTimeout only runs while a request's headers arrive, not
// while a socket is idle, so it keeps its default.
const cloudflaredIdleSocketMs = 90_000;
const keepAliveTimeoutMs = cloudflaredIdleSocketMs + 5_000;

const createHttpServer = () =>
  createServer({ keepAliveTimeout: keepAliveTimeoutMs });

const HttpServerLive = Layer.unwrap(
  AppConfig.pipe(
    Effect.map((config) =>
      NodeHttpServer.layer(createHttpServer, {
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
