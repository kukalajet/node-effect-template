import { type EmailType, UserAlreadyExists } from "@node-effect/domain";

import { findSqlError } from "../error-diagnostics.ts";

import { userEmailUniqueConstraint } from "./schema.ts";

const isUserEmailConflict = (cause: unknown): boolean => {
  const reason = findSqlError(cause)?.reason;

  return (
    reason?._tag === "UniqueViolation" &&
    reason.constraint === userEmailUniqueConstraint
  );
};

// Only the email constraint means the address is taken; any other unique
// violation stays a persistence failure, so this leaves it undefined.
const userEmailConflict = (email: EmailType, cause: unknown) => {
  if (!isUserEmailConflict(cause)) return undefined;

  return new UserAlreadyExists({ email });
};

export { userEmailConflict };
