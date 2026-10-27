import { assert, describe, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause } from "effect";
import { SqlError } from "effect/sql";

import { UserRepositoryError } from "@node-effect/application";
import { UserAlreadyExists } from "@node-effect/domain";

import {
  toUserInsertError,
  toUserRepositoryError,
} from "../user-repository-error.ts";

const uniqueViolation = (constraint: string) =>
  new EffectDrizzleQueryError({
    query: "insert into users",
    params: [],
    cause: Cause.fail(
      new SqlError.SqlError({
        reason: new SqlError.UniqueViolation({
          cause: new Error("duplicate key"),
          constraint,
        }),
      }),
    ),
  });

describe("user repository errors", () => {
  it("retain the operation, the cause, and safe diagnostics", () => {
    const cause = new SqlError.SqlError({
      reason: new SqlError.AuthorizationError({
        cause: Object.assign(new Error("permission denied"), { code: "42501" }),
      }),
    });
    const failure = toUserRepositoryError("findById", cause);

    assert.strictEqual(failure.operation, "findById");
    assert.strictEqual(failure.cause, cause);
    assert.deepStrictEqual(failure.diagnostics, {
      reason: "AuthorizationError",
      code: "42501",
    });
  });

  it("map only the email constraint to UserAlreadyExists", () => {
    const conflict = toUserInsertError(
      "ada@example.com",
      uniqueViolation("users_email_key"),
    );

    assert.instanceOf(conflict, UserAlreadyExists);
    assert.strictEqual(conflict.email, "ada@example.com");

    const failure = toUserInsertError(
      "ada@example.com",
      uniqueViolation("other_constraint"),
    );

    assert.instanceOf(failure, UserRepositoryError);
    assert.strictEqual(failure.operation, "insert");
    assert.deepStrictEqual(failure.diagnostics, { reason: "UniqueViolation" });
  });
});
