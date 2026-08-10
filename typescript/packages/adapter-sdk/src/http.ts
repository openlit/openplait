import type { ScalarValue } from "@openplait/core";

import { AdapterError, isAbortError } from "./errors.js";
import type { AdapterValidationIssue } from "./types.js";

const SAFE_HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface HttpAdapterConfig {
  url: string;
  httpHeaders?: Record<string, string>;
  tenantId?: string;
  username?: string;
  password?: string;
  bearerToken?: string;
  requestTimeoutMs?: number;
  queryTimeoutMs?: number;
}

export interface HttpJsonRequestOptions {
  fetch: typeof fetch;
  datasourceName: string;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  requestId?: string | undefined;
  headers?: Record<string, string> | undefined;
  method?: "GET" | "POST";
  body?: string;
}

export function validateHttpAdapterConfig(config: HttpAdapterConfig): AdapterValidationIssue[] {
  const errors: AdapterValidationIssue[] = [];
  try {
    const url = new URL(config.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push({ code: "CONFIG_INVALID", path: "/url", message: "URL must use http or https." });
    }
    if (url.search || url.hash) {
      errors.push({ code: "CONFIG_INVALID", path: "/url", message: "URL cannot contain a query string or fragment." });
    }
  } catch {
    errors.push({ code: "CONFIG_INVALID", path: "/url", message: "URL is invalid." });
  }
  for (const [path, value] of [
    ["/requestTimeoutMs", config.requestTimeoutMs],
    ["/queryTimeoutMs", config.queryTimeoutMs],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      errors.push({ code: "CONFIG_INVALID", path, message: "Value must be a positive integer." });
    }
  }
  if ((config.username === undefined) !== (config.password === undefined)) {
    errors.push({ code: "CONFIG_INVALID", path: "/username", message: "Basic auth requires both username and password." });
  }
  if (config.bearerToken !== undefined && config.username !== undefined) {
    errors.push({ code: "CONFIG_INVALID", path: "/bearerToken", message: "Bearer and basic authentication cannot be configured together." });
  }
  for (const [name, value] of Object.entries(config.httpHeaders ?? {})) {
    if (!SAFE_HEADER.test(name) || /[\r\n]/.test(value)) {
      errors.push({ code: "CONFIG_INVALID", path: `/httpHeaders/${name}`, message: "Header names and values must be valid HTTP headers." });
    }
  }
  return errors;
}

export function httpHeaders(config: HttpAdapterConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json", ...config.httpHeaders };
  if (config.username !== undefined) {
    headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password ?? ""}`).toString("base64")}`;
  } else if (config.bearerToken !== undefined) {
    headers.Authorization = `Bearer ${config.bearerToken}`;
  }
  if (config.tenantId) headers["X-Scope-OrgID"] = config.tenantId;
  return headers;
}

export function datasourceUrl(baseUrl: string, path: string, parameters: Record<string, string | number | undefined> = {}): URL {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.replace(/^\//, ""), base);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url;
}

export function requireSafeRequestId(requestId: string | undefined): string {
  if (!requestId || !SAFE_REQUEST_ID.test(requestId)) {
    throw new AdapterError("QUERY_VALIDATION_FAILED", "Execution requires a safe audit request ID or query ID.", {
      path: "/execution/audit/requestId",
    });
  }
  return requestId;
}

export function scalarTimestamp(value: ScalarValue, path: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new AdapterError("INVALID_PARAMETER", "Time range timestamp is invalid.", { path });
  return parsed;
}

export function boundedEpochRange(
  from: ScalarValue,
  to: ScalarValue,
  maxTimeRangeMs?: number,
): { startMs: number; endMs: number } {
  const startMs = scalarTimestamp(from, "/spec/timeRange/from");
  const endMs = scalarTimestamp(to, "/spec/timeRange/to");
  if (endMs < startMs) throw new AdapterError("INVALID_PARAMETER", "Time range end must not precede its start.", { path: "/spec/timeRange" });
  if (maxTimeRangeMs !== undefined && endMs - startMs > maxTimeRangeMs) {
    throw new AdapterError("TIME_RANGE_TOO_LARGE", `Time range exceeds ${maxTimeRangeMs}ms.`, { path: "/spec/timeRange" });
  }
  return { startMs, endMs };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export async function requestJson<T>(url: URL, options: HttpJsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(`${options.datasourceName} request timed out.`, "TimeoutError"));
  }, options.timeoutMs);
  try {
    const response = await options.fetch(url, {
      method: options.method ?? "GET",
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.body === undefined ? {} : { body: options.body }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2_000);
      throw new AdapterError("EXECUTION_FAILED", `${options.datasourceName} returned HTTP ${response.status}.`, {
        details: {
          status: response.status,
          statusText: response.statusText,
          body,
          endpoint: url.pathname,
          queryParameterNames: Array.from(url.searchParams.keys()).sort(),
          ...(options.requestId ? { requestId: options.requestId } : {}),
          ...(response.headers.get("x-request-id") ? { upstreamRequestId: response.headers.get("x-request-id") } : {}),
        },
      });
    }
    return await response.json() as T;
  } catch (error) {
    if (timedOut) throw new AdapterError("TIMEOUT", `${options.datasourceName} request exceeded ${options.timeoutMs}ms.`, { cause: error });
    if (options.signal?.aborted || isAbortError(error)) throw new AdapterError("ABORTED", `${options.datasourceName} request was cancelled.`, { cause: error });
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("EXECUTION_FAILED", `${options.datasourceName} request failed.`, { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
