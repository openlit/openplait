export type JaegerTag = {
  key: string;
  type?: string;
  value: unknown;
};

export type JaegerLog = {
  timestamp?: number;
  fields?: JaegerTag[];
};

export type JaegerRef = {
  refType?: string;
  traceID?: string;
  spanID?: string;
};

export type JaegerSpan = {
  traceID?: string;
  spanID?: string;
  operationName?: string;
  references?: JaegerRef[];
  startTime?: number;
  duration?: number;
  tags?: JaegerTag[];
  logs?: JaegerLog[];
  processID?: string;
};

export type JaegerProcess = {
  serviceName?: string;
  tags?: JaegerTag[];
};

export type JaegerTrace = {
  traceID?: string;
  spans?: JaegerSpan[];
  processes?: Record<string, JaegerProcess>;
};

export type JaegerServicesResponse = {
  data?: string[];
};

export type JaegerTracesResponse = {
  data?: JaegerTrace[];
};

export interface JaegerAdapterConfig {
  url: string;
  httpHeaders?: Record<string, string>;
  username?: string;
  password?: string;
  bearerToken?: string;
  requestTimeoutMs?: number;
  maxResultRows?: number;
  maxTimeRangeMs?: number;
  /** Prefer an explicit service list instead of `/api/services`. */
  services?: string[];
  /** Default per-service search limit (Jaeger `limit` query param). */
  perServiceLimit?: number;
}

export interface JaegerAdapterOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export interface JaegerSearchParams {
  service: string;
  startMs: number;
  endMs: number;
  limit?: number;
  operation?: string;
  tags?: Record<string, string>;
}

export interface JaegerNormalizedSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  serviceName: string;
  timestamp: string;
  durationNs: number;
  statusCode: string;
  spanKind?: string;
  spanAttributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  events: Array<{
    name: string;
    timestamp?: string;
    attributes: Record<string, string>;
  }>;
  cost?: number;
}

export interface JaegerCompiledRequest {
  endpoint: "search";
  service: string;
  startMs: number;
  endMs: number;
  limit: number;
  operation?: string;
  tags?: Record<string, string>;
}
