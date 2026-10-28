import { Effect } from "effect";

import { AppConfig } from "@node-effect/config";

import { pollWorkerWork } from "./jobs/worker-work.ts";
import { runWorker } from "./worker-runtime.ts";

const worker = AppConfig.pipe(
  Effect.flatMap((config) =>
    pollWorkerWork({
      intervalMs: config.workerPollIntervalMs,
      passTimeoutMs: config.workerPassTimeoutMs,
    }),
  ),
);

runWorker(worker);
