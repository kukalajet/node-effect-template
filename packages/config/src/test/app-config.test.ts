import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Redacted } from "effect";

import { AppConfig, appConfig } from "@node-effect/config";

const environment = (env: Record<string, string>) =>
  ConfigProvider.fromEnv({ env });

describe("appConfig", () => {
  it.effect("fails when DATABASE_URL is missing", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(appConfig.parse(environment({})));

      assert.isTrue(Exit.isFailure(exit));
    }),
  );

  it.effect("applies the API and worker defaults", () =>
    Effect.gen(function* () {
      const config = yield* appConfig.parse(
        environment({ DATABASE_URL: "postgres://test" }),
      );

      assert.strictEqual(config.apiHost, "127.0.0.1");
      assert.strictEqual(config.apiPort, 8000);
      assert.strictEqual(config.workerPollIntervalMs, 5000);
    }),
  );

  it.effect("reads overrides from the environment", () =>
    Effect.gen(function* () {
      const config = yield* appConfig.parse(
        environment({
          DATABASE_URL: "postgres://test",
          API_HOST: "0.0.0.0",
          API_PORT: "9000",
          WORKER_POLL_INTERVAL_MS: "1500",
        }),
      );

      assert.strictEqual(config.apiHost, "0.0.0.0");
      assert.strictEqual(config.apiPort, 9000);
      assert.strictEqual(config.workerPollIntervalMs, 1500);
    }),
  );

  for (const value of ["0", "-1", "1.5", "Infinity", "invalid"]) {
    it.effect(`rejects worker polling interval ${value}`, () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          appConfig.parse(
            environment({
              DATABASE_URL: "postgres://test",
              WORKER_POLL_INTERVAL_MS: value,
            }),
          ),
        );

        assert.isTrue(Exit.isFailure(exit));
      }),
    );
  }

  for (const value of ["0", "65536", "http"]) {
    it.effect(`rejects API port ${value}`, () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          appConfig.parse(
            environment({ DATABASE_URL: "postgres://test", API_PORT: value }),
          ),
        );

        assert.isTrue(Exit.isFailure(exit));
      }),
    );
  }
});

describe("AppConfig.layer", () => {
  it.effect("reads the active ConfigProvider and keeps the URL redacted", () =>
    Effect.gen(function* () {
      const config = yield* AppConfig;

      assert.strictEqual(
        Redacted.value(config.databaseUrl),
        "postgres://secret@test",
      );

      assert.strictEqual(String(config.databaseUrl), "<redacted>");
      assert.notInclude(JSON.stringify(config), "secret");
    }).pipe(
      Effect.provide(AppConfig.layer),
      Effect.provide(
        ConfigProvider.layer(
          environment({ DATABASE_URL: "postgres://secret@test" }),
        ),
      ),
    ),
  );
});
