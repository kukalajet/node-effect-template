import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Logger, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";

import { UserRepository, UserRepositoryError } from "@node-effect/application";
import {
  type User,
  UserAlreadyExists,
  UserId,
  UserNotFound,
} from "@node-effect/domain";

import { Api } from "../../api-contract.ts";
import { assertContractResponse } from "../../test/contract-response.ts";
import { UserHandlers } from "../routes.ts";

const UsersApi = HttpApi.make(Api.identifier).add(Api.groups.users);

const UserRoutes = HttpApiBuilder.layer(UsersApi).pipe(
  Layer.provide(UserHandlers),
  Layer.provide(HttpServer.layerServices),
  // The routes log repository failures; http-errors.test.ts checks those logs.
  Layer.provide(Logger.layer([])),
);

const userId = Schema.decodeUnknownSync(UserId)(
  "d5b9d3de-fda5-4a78-b8a5-2f3b60634d95",
);

const createdAt = new Date("2026-08-09T12:00:00.000Z");

const user: User = {
  id: userId,
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  createdAt,
};

const userJson = { ...user, createdAt: createdAt.toISOString() };
const unknownUserId = "00000000-0000-4000-8000-000000000000";

const repositoryFailure = (operation: UserRepositoryError["operation"]) =>
  new UserRepositoryError({
    operation,
    cause: new Error("Unreachable PostgreSQL"),
    diagnostics: { reason: "ConnectionError", code: "ECONNREFUSED" },
  });

// Records every insert and list limit, so a test can tell whether a request
// got that far and what it asked for.
const fakeRepository = (overrides: Partial<UserRepository["Service"]> = {}) => {
  const inserted: Array<unknown> = [];
  const listLimits: Array<number> = [];

  const layer = Layer.succeed(
    UserRepository,
    UserRepository.of({
      health: Effect.void,
      insert: (input) =>
        Effect.sync(() => {
          inserted.push(input);

          return { ...user, ...input };
        }),
      findById: (id) =>
        id === userId
          ? Effect.succeed(user)
          : Effect.fail(new UserNotFound({ id })),
      list: (limit) =>
        Effect.sync(() => {
          listLimits.push(limit);

          return [user];
        }),
      ...overrides,
    }),
  );

  return { inserted, layer, listLimits };
};

// Serves the users routes with `repository`, checking every response against
// the users contract.
const serve = (repository: Layer.Layer<UserRepository>) => {
  const web = HttpRouter.toWebHandler(
    UserRoutes.pipe(HttpRouter.provideRequest(repository)),
    { disableLogger: true },
  );

  return {
    dispose: web.dispose,
    fetch: async (request: Request) => {
      const response = await web.handler(request);
      await assertContractResponse(UsersApi, request, response);

      return response;
    },
  };
};

const get = (path: string) => new Request(`http://localhost${path}`);

const post = (body: string) =>
  new Request("http://localhost/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

const invalidRequest = {
  error: {
    code: "INVALID_REQUEST",
    message: "The request payload is invalid",
  },
};

describe("GET /users", () => {
  it("lists up to 50 users when the request sets no limit", async () => {
    const repository = fakeRepository();
    const server = serve(repository.layer);

    try {
      const response = await server.fetch(get("/users"));

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), { users: [userJson] });
      assert.deepStrictEqual(repository.listLimits, [50]);
    } finally {
      await server.dispose();
    }
  });

  for (const limit of [1, 100]) {
    it(`lists up to ${limit} users for limit=${limit}`, async () => {
      const repository = fakeRepository();
      const server = serve(repository.layer);

      try {
        const response = await server.fetch(get(`/users?limit=${limit}`));

        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(repository.listLimits, [limit]);
      } finally {
        await server.dispose();
      }
    });
  }

  for (const limit of ["0", "101", "1.5", "ten", ""]) {
    it(`answers 400 for limit=${limit} without reading users`, async () => {
      const repository = fakeRepository();
      const server = serve(repository.layer);

      try {
        const response = await server.fetch(get(`/users?limit=${limit}`));

        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(await response.json(), invalidRequest);
        assert.deepStrictEqual(repository.listLimits, []);
      } finally {
        await server.dispose();
      }
    });
  }

  it("answers 500 without details when the repository fails", async () => {
    const server = serve(
      fakeRepository({ list: () => Effect.fail(repositoryFailure("list")) })
        .layer,
    );

    try {
      const response = await server.fetch(get("/users"));

      assert.strictEqual(response.status, 500);

      assert.deepStrictEqual(await response.json(), {
        error: {
          code: "DATABASE_ERROR",
          message: "The database operation could not be completed",
        },
      });
    } finally {
      await server.dispose();
    }
  });
});

describe("GET /users/:id", () => {
  it("returns the user", async () => {
    const server = serve(fakeRepository().layer);

    try {
      const response = await server.fetch(get(`/users/${userId}`));

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), userJson);
    } finally {
      await server.dispose();
    }
  });

  it("answers 404 for an unknown id", async () => {
    const server = serve(fakeRepository().layer);

    try {
      const response = await server.fetch(get(`/users/${unknownUserId}`));

      assert.strictEqual(response.status, 404);

      assert.deepStrictEqual(await response.json(), {
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    } finally {
      await server.dispose();
    }
  });

  it("answers 400 for an id that is not a UUID", async () => {
    const server = serve(fakeRepository().layer);

    try {
      const response = await server.fetch(get("/users/not-a-uuid"));

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(await response.json(), invalidRequest);
    } finally {
      await server.dispose();
    }
  });
});

describe("POST /users", () => {
  it("creates a user from a valid body", async () => {
    const repository = fakeRepository();
    const server = serve(repository.layer);

    try {
      const response = await server.fetch(
        post(
          JSON.stringify({
            email: "  grace@example.com ",
            displayName: "Grace Hopper",
          }),
        ),
      );

      assert.strictEqual(response.status, 201);

      assert.deepStrictEqual(await response.json(), {
        ...userJson,
        email: "grace@example.com",
        displayName: "Grace Hopper",
      });

      assert.deepStrictEqual(repository.inserted, [
        { email: "grace@example.com", displayName: "Grace Hopper" },
      ]);
    } finally {
      await server.dispose();
    }
  });

  it("answers 409 when the email is taken", async () => {
    const server = serve(
      fakeRepository({
        insert: (input) =>
          Effect.fail(new UserAlreadyExists({ email: input.email })),
      }).layer,
    );

    try {
      const response = await server.fetch(
        post(JSON.stringify({ email: user.email, displayName: "Ada" })),
      );

      assert.strictEqual(response.status, 409);

      assert.deepStrictEqual(await response.json(), {
        error: {
          code: "USER_ALREADY_EXISTS",
          message: "A user with this email already exists",
        },
      });
    } finally {
      await server.dispose();
    }
  });

  it("answers 500 without details when the insert fails", async () => {
    const server = serve(
      fakeRepository({
        insert: () => Effect.fail(repositoryFailure("insert")),
      }).layer,
    );

    try {
      const response = await server.fetch(
        post(JSON.stringify({ email: user.email, displayName: "Ada" })),
      );

      assert.strictEqual(response.status, 500);
    } finally {
      await server.dispose();
    }
  });

  for (const { name, body } of [
    { name: "malformed JSON", body: "{" },
    { name: "an empty body", body: "" },
    {
      name: "an invalid email",
      body: JSON.stringify({ email: "x", displayName: "Ada" }),
    },
    {
      name: "a blank display name",
      body: JSON.stringify({ email: user.email, displayName: " " }),
    },
    {
      name: "a NUL character in the email",
      body: JSON.stringify({
        email: "a\u0000b@example.com",
        displayName: "Ada",
      }),
    },
    {
      name: "a NUL character in the display name",
      body: JSON.stringify({ email: user.email, displayName: "a\u0000b" }),
    },
    { name: "a missing field", body: JSON.stringify({ email: user.email }) },
    {
      name: "an unknown field",
      body: JSON.stringify({
        email: user.email,
        displayName: "Ada",
        admin: true,
      }),
    },
  ]) {
    it(`answers 400 for ${name} without inserting`, async () => {
      const repository = fakeRepository();
      const server = serve(repository.layer);

      try {
        const response = await server.fetch(post(body));

        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(await response.json(), invalidRequest);
        assert.deepStrictEqual(repository.inserted, []);
      } finally {
        await server.dispose();
      }
    });
  }

  it("answers 413 for a body over the limit without inserting", async () => {
    const repository = fakeRepository();
    const server = serve(repository.layer);

    try {
      const response = await server.fetch(
        post(
          JSON.stringify({
            email: user.email,
            displayName: "a".repeat(8 * 1024),
          }),
        ),
      );

      assert.strictEqual(response.status, 413);

      assert.deepStrictEqual(await response.json(), {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "The request payload is too large",
        },
      });

      assert.deepStrictEqual(repository.inserted, []);
    } finally {
      await server.dispose();
    }
  });
});
