/** The HTTP status of a backend refusal, when the error carries one. */
export function httpStatusOf(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown } | undefined)
    ?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/**
 * What an error says, for a sentence shown to a person. The approvals client
 * puts the backend's own wording in `message`, which is written to be read.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
