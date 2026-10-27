import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";

import { UserRepository, UserRepositoryError } from "@node-effect/application";

import { Api } from "../../api-contract.ts";
import { assertContractResponse } from "../../test/contract-response.ts";
import { HealthHandlers } from "../routes.ts";

const HealthApi = HttpApi.make(Api.identifier).add(Api.groups.health);

const HealthRoutes = HttpApiBuilder.layer(HealthApi).pipe(
  Layer.provide(HealthHandlers),
  Layer.provide(HttpServer.layerServices),
  Layer.provide(Logger.layer([])),
);

const databaseUnavailable = new UserRepositoryError({
  operation: "health",
  cause: new Error("Unreachable PostgreSQL"),
  diagnostics: { reason: "ConnectionError", code: "ECONNREFUSED" },
});

// A repository whose health check succeeds or fails and counts its calls.
const repositoryWithHealth = (available: boolean) => {
  const health = { checks: 0 };
  const layer = Layer.mock(UserRepository, {
    health: Effect.suspend(() => {
      health.checks += 1;
      if (available) return Effect.void;

      return Effect.fail(databaseUnavailable);
    }),
  });

  return { health, layer };
};

const serve = (repository: Layer.Layer<UserRepository>) => {
  const web = HttpRouter.toWebHandler(
    HealthRoutes.pipe(HttpRouter.provideRequest(repository)),
    { disableLogger: true },
  );

  return {
    dispose: web.dispose,
    fetch: async (path: string) => {
      const request = new Request(`http://localhost${path}`);
      const response = await web.handler(request);
      await assertContractResponse(HealthApi, request, response);

      return response;
    },
  };
};

describe("health routes", () => {
  for (const available of [true, false]) {
    const state = available ? "available" : "down";

    it(`liveness answers 200 without the database while it is ${state}`, async () => {
      const repository = repositoryWithHealth(available);
      const server = serve(repository.layer);

      try {
        const response = await server.fetch("/health/live");

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(await response.json(), { status: "ok" });
        assert.strictEqual(repository.health.checks, 0);
      } finally {
        await server.dispose();
      }
    });
  }

  for (const path of ["/health/ready", "/health"]) {
    it(`${path} answers 200 when the database is available`, async () => {
      const repository = repositoryWithHealth(true);
      const server = serve(repository.layer);

      try {
        const response = await server.fetch(path);

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(await response.json(), {
          status: "ok",
          database: "ok",
        });
        assert.strictEqual(repository.health.checks, 1);
      } finally {
        await server.dispose();
      }
    });

    it(`${path} answers 503 when the database is down`, async () => {
      const repository = repositoryWithHealth(false);
      const server = serve(repository.layer);

      try {
        const response = await server.fetch(path);

        assert.strictEqual(response.status, 503);
        assert.deepStrictEqual(await response.json(), {
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "The database is unavailable",
          },
        });
        assert.strictEqual(repository.health.checks, 1);
      } finally {
        await server.dispose();
      }
    });
  }
});
