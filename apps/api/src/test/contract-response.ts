import { assert } from "@effect/vitest";
import { Schema } from "effect";
import { HttpApi, type HttpApiGroup, HttpApiSchema } from "effect/http-api";

const isPathParameter = (segment: string) => segment.startsWith(":");

const matchesPath = (pattern: string, segments: ReadonlyArray<string>) => {
  const patternSegments = pattern.split("/");

  return (
    patternSegments.length === segments.length &&
    patternSegments.every(
      (segment, index) =>
        isPathParameter(segment) || segment === segments[index],
    )
  );
};

// The schemas `api` declares for the status of `response` to `request`.
const declaredResponseSchemas = <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<Id, Groups>,
  request: Request,
  response: Response,
) => {
  const pathname = new URL(request.url).pathname;
  const segments = pathname.split("/");
  let matched = false;
  // The router prefers a literal segment to a parameter, so the endpoint with
  // the fewest parameters answers (`/users/me` over `/users/:id`).
  let parameters = Infinity;
  let schemas: ReadonlyArray<Schema.Top> = [];

  HttpApi.reflect(api, {
    predicate: ({ endpoint }) =>
      endpoint.method === request.method &&
      matchesPath(endpoint.path, segments),
    onGroup: () => {},
    onEndpoint: ({ endpoint, successes, errors }) => {
      const count = endpoint.path.split("/").filter(isPathParameter).length;
      if (count >= parameters) return;

      matched = true;
      parameters = count;
      const byStatus = response.status < 400 ? successes : errors;
      schemas = byStatus.get(response.status) ?? [];
    },
  });

  assert.isTrue(
    matched,
    `Undocumented operation: ${request.method} ${pathname}`,
  );

  assert.isNotEmpty(
    schemas,
    `Undocumented response: ${request.method} ${pathname} ${response.status}`,
  );

  return schemas;
};

// A JSON body matches when it is a valid JSON encoding of the schema, which is
// what HttpApi writes; a no-content schema matches an empty body.
const bodyMatches = (schema: Schema.Top, text: string) => {
  if (HttpApiSchema.isNoContent(schema.ast)) return text === "";
  if (text === "") return false;

  const isEncodedBody = Schema.is(Schema.toEncoded(Schema.toCodecJson(schema)));

  return isEncodedBody(JSON.parse(text));
};

// Fails unless the contract documents this operation and status, and the body
// matches one of the schemas it declares for that status.
const assertContractResponse = async <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<Id, Groups>,
  request: Request,
  response: Response,
) => {
  const schemas = declaredResponseSchemas(api, request, response);
  const text = await response.clone().text();
  const pathname = new URL(request.url).pathname;

  assert.isTrue(
    schemas.some((schema) => bodyMatches(schema, text)),
    `Response does not match its contract: ${request.method} ${pathname} ${response.status}`,
  );
};

export { assertContractResponse };
