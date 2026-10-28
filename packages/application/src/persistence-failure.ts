import { Cause, Predicate, Schema } from "effect";

const PersistenceFailureTypeId = "~@node-effect/application/PersistenceFailure";

// Database adapters derive these from the raw cause without copying
// messages, SQL, parameters, or stored values.
const PersistenceDiagnostics = Schema.Struct({
  reason: Schema.String,
  code: Schema.optional(Schema.String),
  validationPaths: Schema.optional(Schema.Array(Schema.String)),
});

// Every repository error is built from these fields, so callers can recognize
// one without listing each class.
const persistenceFailureFields = <
  const Operations extends ReadonlyArray<string>,
>(
  operations: Operations,
) => ({
  [PersistenceFailureTypeId]: Schema.tag(PersistenceFailureTypeId),
  operation: Schema.Literals(operations),
  cause: Schema.Defect(),
  diagnostics: PersistenceDiagnostics,
});

type PersistenceFailure = {
  readonly [PersistenceFailureTypeId]: typeof PersistenceFailureTypeId;
  readonly _tag: string;
  readonly operation: string;
  readonly cause: unknown;
  readonly diagnostics: typeof PersistenceDiagnostics.Type;
};

const isPersistenceFailure = (u: unknown): u is PersistenceFailure =>
  Predicate.hasProperty(u, PersistenceFailureTypeId);

// The cause can carry SQL, parameters, and stored values; log this instead.
const persistenceFailureReport = (error: PersistenceFailure) => ({
  _tag: error._tag,
  operation: error.operation,
  diagnostics: error.diagnostics,
});

// Replaces each failure or defect that `isSensitive` accepts with its
// `report`, and keeps every other reason as it is. `Cause.map` is not enough:
// when a finalizer dies after the program failed, Effect reports the original
// failure as a defect too.
const redactCause = <A>(
  cause: Cause.Cause<unknown>,
  isSensitive: (value: unknown) => value is A,
  report: (value: A) => unknown,
): Cause.Cause<unknown> =>
  Cause.fromReasons(
    cause.reasons.map((reason): Cause.Reason<unknown> => {
      if (Cause.isFailReason(reason) && isSensitive(reason.error)) {
        return Cause.makeFailReason(report(reason.error));
      }

      if (Cause.isDieReason(reason) && isSensitive(reason.defect)) {
        return Cause.makeDieReason(report(reason.defect));
      }

      return reason;
    }),
  );

export {
  isPersistenceFailure,
  type PersistenceFailure,
  persistenceFailureFields,
  persistenceFailureReport,
  redactCause,
};
