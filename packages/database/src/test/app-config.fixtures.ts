import { ConfigProvider, Layer } from "effect";

import { AppConfig } from "@node-effect/config";

// AppConfig as the environment gives it: its defaults, overridden by `env`,
// with a database URL that adapter unit tests never connect to.
const testAppConfig = (env: Record<string, string> = {}) =>
  AppConfig.layer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: { DATABASE_URL: "postgresql://unused", ...env },
        }),
      ),
    ),
  );

export { testAppConfig };
