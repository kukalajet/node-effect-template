import { processWorkerWorkPass } from "./jobs/worker-work.ts";
import { runWorker } from "./worker-runtime.ts";

runWorker(processWorkerWorkPass());
