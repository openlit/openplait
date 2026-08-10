import type {
  CompiledField,
} from "@openplait/adapter-sdk";
import type {
  DataField,
  DataFieldType,
  QueryResult,
} from "@openplait/core";

import type { ClickHouseRow } from "./types.js";

export interface ClickHouseResponse {
  data: ClickHouseRow[];
  meta?: Array<{ name: string; type: string }>;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
  rows?: number;
}

function typeFromClickHouse(type: string): DataFieldType {
  const unwrapped = type.replace(/^(?:Nullable|LowCardinality)\((.*)\)$/, "$1");
  if (/^(?:U?Int\d+|Float\d+|Decimal)/.test(unwrapped)) return "number";
  if (unwrapped === "Bool") return "boolean";
  if (/^Date(?:Time)?/.test(unwrapped)) return "time";
  if (/^(?:Array|Map|Tuple|Nested|JSON|Object)\b/.test(unwrapped)) return "json";
  return "string";
}

function normalizeValue(value: unknown, type: DataFieldType): unknown {
  if (value === null || value === undefined) return null;
  if (type === "number" || type === "duration") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
    return null;
  }
  return value;
}

function inferredFields(response: ClickHouseResponse): CompiledField[] {
  if (response.meta?.length) {
    return response.meta.map((field) => ({
      name: field.name,
      type: typeFromClickHouse(field.type),
    }));
  }
  const first = response.data[0];
  if (!first) return [];
  return Object.entries(first).map(([name, value]) => ({
    name,
    type:
      typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : typeof value === "object"
            ? "json"
            : "string",
  }));
}

export function normalizeClickHouseResponse(
  response: ClickHouseResponse,
  fields: readonly CompiledField[] | undefined,
  options: {
    frameName?: string;
    adapterVersion: string;
    executionTimeMs: number;
  },
): QueryResult {
  const resolvedFields = fields?.length ? fields : inferredFields(response);
  const dataFields: DataField[] = resolvedFields.map((field) => ({
    name: field.name,
    type: field.type,
    values: response.data.map((row) => normalizeValue(row[field.name], field.type)),
    ...(field.unit === undefined ? {} : { unit: field.unit }),
  }));

  return {
    frames: [
      {
        ...(options.frameName === undefined ? {} : { name: options.frameName }),
        length: response.data.length,
        fields: dataFields,
      },
    ],
    metadata: {
      datasource: "clickhouse",
      adapterVersion: options.adapterVersion,
      executionTimeMs: options.executionTimeMs,
      rowsRead: response.statistics?.rows_read ?? response.data.length,
      rowsReturned: response.data.length,
      cache: "bypass",
      warnings: [],
    },
  };
}
