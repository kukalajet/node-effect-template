import { Effect } from "effect";

import { AppConfig } from "@node-effect/config";

import { processWorkerWorkPass } from "./jobs/worker-work.ts";
import { runWorker } from "./worker-runtime.ts";

const pass = AppConfig.pipe(
  Effect.flatMap((config) => processWorkerWorkPass(config.workerPassTimeoutMs)),
);

runWorker(pass);
