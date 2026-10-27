import { Layer } from "effect";

import {
  DatabaseLive,
  PgClientLive,
  UserRepositoryLive,
} from "@node-effect/database";

// The adapters behind the application ports the routes use. Add a feature's
// repository here when its routes need it.
const RequestServicesLive = UserRepositoryLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(PgClientLive),
);

export { RequestServicesLive };
