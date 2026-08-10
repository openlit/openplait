export type AdapterErrorCode =
  | "ABORTED"
  | "CONFIG_INVALID"
  | "DATASET_NOT_FOUND"
  | "EXECUTION_FAILED"
  | "FIELD_NOT_FOUND"
  | "INVALID_PARAMETER"
  | "NATIVE_QUERY_REJECTED"
  | "QUERY_LIMIT_EXCEEDED"
  | "QUERY_VALIDATION_FAILED"
  | "TIME_RANGE_REQUIRED"
  | "TIME_RANGE_TOO_LARGE"
  | "TIMEOUT"
  | "UNSUPPORTED_OPERATION";

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly path?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AdapterErrorCode,
    message: string,
    options: {
      cause?: unknown;
      path?: string;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AdapterError";
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}
