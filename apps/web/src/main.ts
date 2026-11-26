import { BrowserRuntime } from "@effect/platform-browser";
import { BrowserHost, type Html } from "@effect/ui/html";
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

// The page calls the API under /api on its own origin: the dev server and
// `vp preview` forward those requests to the API without the prefix, and
// production has to route them the same way (README, Web app).
const apiUrl = new URL("/api", window.location.origin);

// The page shows every failure a call can have in its place, so only a defect
// fails it as a whole. Its cause goes to the console; the reader gets this.
const mountOptions: BrowserHost.MountOptions<Html.Elements> = {
  fallback: (_failure, h) =>
    h.main
      .class("users-page")
      .children(
        h.p
          .class("notice")
          .attr("role", "alert")
          .children("Something went wrong. Reload the page to try again."),
      ),
};

const App = Layer.unwrap(
  Effect.map(rootElement, (root) =>
    BrowserHost.mount(UsersPage, {}, root, mountOptions),
  ),
).pipe(
  Layer.provide(ApiClient.layer(apiUrl)),
  Layer.provide(FetchHttpClient.layer),
);

BrowserRuntime.runMain(Layer.launch(App));
