import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";

const appConfig = Config.all({
  databaseUrl: Config.Redacted("DATABASE_URL"),
  apiHost: Config.NonEmptyString("API_HOST").pipe(
    Config.withDefault("127.0.0.1"),
  ),
  apiPort: Config.Port("API_PORT").pipe(Config.withDefault(8000)),
  workerPollIntervalMs: Config.schema(
    Schema.Int.check(Schema.isGreaterThan(0)),
    "WORKER_POLL_INTERVAL_MS",
  ).pipe(Config.withDefault(5000)),
});

class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly databaseUrl: Redacted.Redacted<string>;
    readonly apiHost: string;
    readonly apiPort: number;
    readonly workerPollIntervalMs: number;
  }
>()("@node-effect/config/AppConfig") {
  // Reads `process.env` through the default ConfigProvider. Tests and tools
  // can replace the provider with `ConfigProvider.layer`.
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.map(appConfig, AppConfig.of),
  );
}

export { AppConfig, appConfig };
