// Typed client for the Pehle API. Types are generated from the Rust server's OpenAPI document
// (`bun run gen`), so a change to a Rust response type is a compile error here until handled.
import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];

/** Error body returned by every failing endpoint. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const pehleHeader: Middleware = {
  onRequest({ request }) {
    // Mutating requests must carry this header (CSRF guard on the server).
    request.headers.set("X-Pehle", "1");
    return request;
  },
};

export function createPehleClient(baseUrl = "") {
  const client = createClient<paths>({ baseUrl, credentials: "include" });
  client.use(pehleHeader);
  return client;
}

export type PehleClient = ReturnType<typeof createPehleClient>;

/** Unwrap an openapi-fetch result, throwing `ApiError` with the server's message on failure. */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise;
  if (response.ok) return data as T;
  const body = error as { error?: { code?: string; message?: string } } | undefined;
  throw new ApiError(
    response.status,
    body?.error?.code ?? "http_error",
    body?.error?.message ?? `Request failed (${response.status})`,
  );
}
