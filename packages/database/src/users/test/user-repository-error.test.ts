import { assert, describe, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause } from "effect";
import { SqlError } from "effect/sql";

import { UserAlreadyExists } from "@node-effect/domain";

import { userEmailConflict } from "../user-repository-error.ts";

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

describe("userEmailConflict", () => {
  it("maps only the email constraint to UserAlreadyExists", () => {
    const conflict = userEmailConflict(
      "ada@example.com",
      uniqueViolation("users_email_key"),
    );

    assert.instanceOf(conflict, UserAlreadyExists);
    assert.strictEqual(conflict.email, "ada@example.com");

    assert.isUndefined(
      userEmailConflict("ada@example.com", uniqueViolation("other_constraint")),
    );
  });
});
