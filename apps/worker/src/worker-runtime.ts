import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer, Logger } from "effect";

import type { UserRepository } from "@node-effect/application";
import { AppConfig } from "@node-effect/config";
import {
  DatabaseLive,
  PgClientLive,
  UserRepositoryLive,
} from "@node-effect/database";

import { reportWorkerFailure } from "./worker-errors.ts";

const WorkerServicesLive = UserRepositoryLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(PgClientLive),
);

// Everything a worker program may use. Add a job's ports here, and their
// adapters to WorkerServicesLive.
type WorkerRequirements = AppConfig | UserRepository;

// Runs `program` as the process: 0 when it completes, 1 when it fails, 130
// when SIGINT or SIGTERM interrupts it. reportWorkerFailure logs failures, so
// the runtime's own reporting is off; it would log the raw cause.
const runWorker = <E>(program: Effect.Effect<void, E, WorkerRequirements>) => {
  const worker = program.pipe(
    Effect.provide(WorkerServicesLive),
    Effect.provide(AppConfig.layer),
    Effect.tapCause(reportWorkerFailure),
    Effect.provide(Logger.layer([Logger.consoleJson])),
  );

  NodeRuntime.runMain(worker, { disableErrorReporting: true });
};

export { runWorker };
