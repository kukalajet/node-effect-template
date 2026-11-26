import { BrowserRuntime } from "@effect/platform-browser";
import { BrowserHost } from "@effect/ui/html";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { ApiClient } from "./api-client.ts";
import { UsersPage } from "./users/users-page.ts";

// The element index.html gives the app to render into.
const rootElement = Effect.suspend(() => {
  const root = document.getElementById("root");

  if (root === null) {
    return Effect.die(new Error("index.html has no element with id root"));
  }

  return Effect.succeed(root);
});

// The page is served from the same origin as the API, which it reaches under
// /api: the dev server forwards those requests to the API.
const apiUrl = new URL("/api", window.location.origin);

const App = Layer.unwrap(
  Effect.map(rootElement, (root) => BrowserHost.mount(UsersPage, {}, root)),
).pipe(
  Layer.provide(ApiClient.layer(apiUrl)),
  Layer.provide(FetchHttpClient.layer),
);

BrowserRuntime.runMain(Layer.launch(App));
