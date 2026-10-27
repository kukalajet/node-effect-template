import { Effect } from "effect";

import { UserRepository } from "@node-effect/application";

const sampleSize = 5;

// A read-only example job: loads a few users and logs how many it found.
const sampleUsersPass = Effect.fn("Worker.sampleUsersPass")(function* () {
  const repository = yield* UserRepository;
  const users = yield* repository.list(sampleSize);

  yield* Effect.logInfo("Worker user sample loaded").pipe(
    Effect.annotateLogs({ service: "worker", userCount: users.length }),
  );
});

export { sampleUsersPass };
