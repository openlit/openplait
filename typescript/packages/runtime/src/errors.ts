export type RuntimeErrorCode =
  | "QUERY_INVALID"
  | "ALERT_RULE_INVALID"
  | "DATASOURCE_NOT_FOUND"
  | "DATASOURCE_KIND_MISMATCH"
  | "DATASOURCE_CONFIG_INVALID"
  | "CAPABILITY_UNSUPPORTED"
  | "TRANSFORM_PUSHDOWN_UNSUPPORTED"
  | "TRANSFORM_STAGE_INVALID"
  | "TRANSFORM_FAILED"
  | "RESULT_INVALID"
  | "DUPLICATE_QUERY_NAME"
  | "DUPLICATE_FRAME_NAME"
  | "CANCELLED"
  | "TIMEOUT";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly path?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    options: { path?: string; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RuntimeError";
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    if (options.details !== undefined) this.details = options.details;
  }
}
