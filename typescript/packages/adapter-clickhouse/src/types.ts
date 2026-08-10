import type { ClickHouseClient } from "@clickhouse/client";
import type {
  BooleanExpression,
  DataFieldType,
  ScalarValue,
  SignalType,
} from "@openplait/core";

export interface ClickHouseFieldMapping {
  expression: string;
  type: DataFieldType;
  clickhouseType: string;
  unit?: string;
  description?: string;
}

export interface ClickHouseDataset {
  name: string;
  signal: SignalType;
  table: string;
  timeField: string;
  fields: Record<string, ClickHouseFieldMapping>;
  defaultFilter?: BooleanExpression;
  arrayJoin?: string;
}

export interface ClickHouseTenantPolicy {
  field: string;
  value: ScalarValue;
}

export interface ClickHouseAdapterConfig {
  url: string;
  username?: string;
  password?: string;
  database?: string;
  /** Additional HTTP headers required by managed ClickHouse endpoints. */
  httpHeaders?: Record<string, string>;
  applicationName?: string;
  requestTimeoutMs?: number;
  queryTimeoutMs?: number;
  maxResultRows?: number;
  maxRowsToRead?: number;
  maxTimeRangeMs?: number;
  requireTimeRange?: boolean;
  allowNativeQueries?: boolean;
  tenant?: ClickHouseTenantPolicy;
  datasets?: ClickHouseDataset[];
}

export interface ClickHouseCompiledStatement {
  statement: string;
}

export interface ClickHouseAdapterOptions {
  client?: ClickHouseClient;
  now?: () => number;
}

export type ClickHouseRow = Record<string, unknown>;
