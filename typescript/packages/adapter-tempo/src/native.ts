import type { NativeQuery, ParameterMap, ScalarValue } from "@openplait/core";
import { validateQuery } from "@openplait/core";
import { AdapterError } from "@openplait/adapter-sdk";

import { resolveParameterValue } from "./parameters.js";
import type {
  TempoAdapterConfig,
  TempoCompiledRequest,
  TempoNativeOptions,
} from "./types.js";

const DEFAULT_MAX_RESULT_ROWS = 1_000;
const DEFAULT_MAX_SPANS_PER_SPAN_SET = 100;
const DEFAULT_MAX_TIME_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const MAX_TRACEQL_LENGTH = 32_768;

function boundedEpochSeconds(
  fromMs: number,
  toMs: number,
  maxTimeRangeMs: number,
): { start: number; end: number } {
  let start = Math.floor(fromMs / 1_000);
  const end = Math.ceil(toMs / 1_000);
  const maxSeconds = Math.floor(maxTimeRangeMs / 1_000);
  // Rounding both boundaries outward can make an otherwise valid exact-limit
  // window one second too wide for Tempo. Keep the inclusive end and move the
  // start forward by at most one second so transport never exceeds validation.
  if (end - start > maxSeconds) start = end - maxSeconds;
  return { start, end };
}

function invalid(message: string, path: string): never {
  throw new AdapterError("QUERY_VALIDATION_FAILED", message, { path });
}

function parseTime(
  value: unknown,
  parameters: ParameterMap,
  variables: ParameterMap | undefined,
  path: string,
): number {
  if (typeof value !== "string" && typeof value !== "number") {
    invalid("Native Tempo time values must be strings or epoch milliseconds.", path);
  }
  const resolved = resolveParameterValue(value as ScalarValue, parameters, variables, path);
  if (Array.isArray(resolved) || resolved === null || typeof resolved === "boolean") {
    invalid("Native Tempo time values must resolve to strings or epoch milliseconds.", path);
  }
  const milliseconds = typeof resolved === "number" ? resolved : Date.parse(resolved);
  if (!Number.isFinite(milliseconds)) invalid(`Time value '${resolved}' is invalid.`, path);
  return milliseconds;
}

function positiveLimit(value: unknown, fallback: number, maximum: number, path: string): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== "number" || !Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new AdapterError("QUERY_LIMIT_EXCEEDED", `Value at '${path}' must be between 1 and ${maximum}.`, {
      path,
      details: { requested: resolved, maximum },
    });
  }
  return resolved;
}

export function validateTraceqlStatement(statement: string): void {
  if (!statement.trim()) invalid("Native TraceQL cannot be empty.", "/spec/native/statement");
  if (statement.length > MAX_TRACEQL_LENGTH) invalid(`Native TraceQL exceeds ${MAX_TRACEQL_LENGTH} characters.`, "/spec/native/statement");
  if (/\0/.test(statement)) invalid("Native TraceQL cannot contain null bytes.", "/spec/native/statement");
}

export function compileNativeTempoQuery(
  query: NativeQuery,
  config: TempoAdapterConfig,
  variables?: ParameterMap,
): TempoCompiledRequest {
  const validation = validateQuery(query);
  if (!validation.valid) {
    throw new AdapterError("QUERY_VALIDATION_FAILED", "The native query is not valid.", {
      details: { errors: validation.errors },
    });
  }
  if (query.spec.mode !== "native" || query.spec.native.language.toLowerCase() !== "traceql") {
    invalid("Tempo native queries must use the 'traceql' language.", "/spec/native/language");
  }
  validateTraceqlStatement(query.spec.native.statement);

  const raw = query.spec.extensions?.["io.openplait.tempo"];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    invalid("Native TraceQL requires an 'io.openplait.tempo' extension with a timeRange.", "/spec/extensions/io.openplait.tempo");
  }
  const options = raw as Partial<TempoNativeOptions>;
  if (typeof options.timeRange !== "object" || options.timeRange === null) {
    invalid("Native TraceQL requires a bounded timeRange.", "/spec/extensions/io.openplait.tempo/timeRange");
  }
  const parameters = query.spec.parameters ?? {};
  const fromMs = parseTime(options.timeRange.from, parameters, variables, "/spec/extensions/io.openplait.tempo/timeRange/from");
  const toMs = parseTime(options.timeRange.to, parameters, variables, "/spec/extensions/io.openplait.tempo/timeRange/to");
  if (toMs < fromMs) invalid("Time range end must not precede its start.", "/spec/extensions/io.openplait.tempo/timeRange");
  const maxTimeRangeMs = config.maxTimeRangeMs ?? DEFAULT_MAX_TIME_RANGE_MS;
  if (toMs - fromMs > maxTimeRangeMs) {
    throw new AdapterError("TIME_RANGE_TOO_LARGE", `Time range exceeds the configured maximum of ${maxTimeRangeMs}ms.`, {
      path: "/spec/extensions/io.openplait.tempo/timeRange",
      details: { requestedMs: toMs - fromMs, maxTimeRangeMs },
    });
  }

  const maximum = config.maxResultRows ?? DEFAULT_MAX_RESULT_ROWS;
  const boundedRange = boundedEpochSeconds(fromMs, toMs, maxTimeRangeMs);
  return {
    endpoint: "search",
    traceql: query.spec.native.statement,
    start: boundedRange.start,
    end: boundedRange.end,
    limit: positiveLimit(options.limit, maximum, maximum, "/spec/extensions/io.openplait.tempo/limit"),
    spansPerSpanSet: positiveLimit(
      options.spansPerSpanSet,
      config.maxSpansPerSpanSet ?? DEFAULT_MAX_SPANS_PER_SPAN_SET,
      config.maxSpansPerSpanSet ?? DEFAULT_MAX_SPANS_PER_SPAN_SET,
      "/spec/extensions/io.openplait.tempo/spansPerSpanSet",
    ),
  };
}
