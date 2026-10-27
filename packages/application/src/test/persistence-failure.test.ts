import { assert, describe, it } from "@effect/vitest";
import { Cause } from "effect";

import {
  isPersistenceFailure,
  persistenceFailureReport,
  redactCause,
  UserRepositoryError,
} from "@node-effect/application";

describe("persistence failures", () => {
  it("recognize repository errors and report them without the cause", () => {
    const error = new UserRepositoryError({
      operation: "findById",
      cause: new Error("secret driver message"),
      diagnostics: { reason: "AuthorizationError", code: "42501" },
    });

    assert.isTrue(isPersistenceFailure(error));
    assert.deepStrictEqual(persistenceFailureReport(error), {
      _tag: "UserRepositoryError",
      operation: "findById",
      diagnostics: { reason: "AuthorizationError", code: "42501" },
    });
    assert.notInclude(
      JSON.stringify(persistenceFailureReport(error)),
      "secret",
    );
  });

  it("do not recognize other errors", () => {
    assert.isFalse(isPersistenceFailure(new Error("unrelated")));
    assert.isFalse(isPersistenceFailure({ _tag: "UserRepositoryError" }));
  });
});

describe("redactCause", () => {
  it("reports sensitive failures and defects and keeps other reasons", () => {
    const isSecret = (value: unknown): value is string => value === "secret";
    const unrelated = Cause.makeDieReason(new Error("unrelated"));
    const cause = Cause.fromReasons([
      Cause.makeFailReason("secret"),
      Cause.makeDieReason("secret"),
      unrelated,
    ]);

    const reasons = redactCause(cause, isSecret, () => "redacted").reasons;

    assert.lengthOf(reasons, 3);
    assert.deepStrictEqual(
      reasons.map((reason) => reason._tag),
      ["Fail", "Die", "Die"],
    );
    assert.deepStrictEqual(
      reasons.map((reason) => {
        if (Cause.isFailReason(reason)) return reason.error;
        if (Cause.isDieReason(reason)) return reason.defect;

        return undefined;
      }),
      ["redacted", "redacted", unrelated.defect],
    );
    assert.strictEqual(reasons[2], unrelated);
  });
});
