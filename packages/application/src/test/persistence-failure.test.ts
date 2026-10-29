import { assert, describe, it } from "@effect/vitest";

import {
  isPersistenceFailure,
  persistenceFailureReport,
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
