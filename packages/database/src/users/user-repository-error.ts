import { UserRepositoryError } from "@node-effect/application";
import { type EmailType, UserAlreadyExists } from "@node-effect/domain";

import { diagnosticsFromCause, findSqlError } from "../error-diagnostics.ts";

import { userEmailUniqueConstraint } from "./schema.ts";

const toUserRepositoryError = (
  operation: UserRepositoryError["operation"],
  cause: unknown,
) =>
  new UserRepositoryError({
    operation,
    cause,
    diagnostics: diagnosticsFromCause(cause),
  });

const isUserEmailConflict = (cause: unknown): boolean => {
  const reason = findSqlError(cause)?.reason;

  return (
    reason?._tag === "UniqueViolation" &&
    reason.constraint === userEmailUniqueConstraint
  );
};

// Only the email constraint means the address is taken; any other unique
// violation is a persistence failure.
const toUserInsertError = (email: EmailType, cause: unknown) => {
  if (isUserEmailConflict(cause)) return new UserAlreadyExists({ email });

  return toUserRepositoryError("insert", cause);
};

export { toUserInsertError, toUserRepositoryError };
