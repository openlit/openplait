export type DataFieldType =
  | "string"
  | "number"
  | "boolean"
  | "time"
  | "duration"
  | "trace"
  | "json";

export interface DataField {
  name: string;
  type: DataFieldType;
  values: unknown[];
  labels?: Record<string, string>;
  unit?: string;
}

export interface FrameMetadata {
  preferredVisualisation?: string;
  custom?: Record<string, unknown>;
}

export interface DataFrame {
  name?: string;
  fields: DataField[];
  length: number;
  metadata?: FrameMetadata;
}

export interface ExecutionMetadata {
  datasource?: string;
  adapterVersion?: string;
  executionTimeMs?: number;
  rowsRead?: number;
  rowsReturned?: number;
  cache?: "hit" | "miss" | "bypass";
  warnings?: string[];
  traceId?: string;
}

export interface QueryResult {
  frames: DataFrame[];
  metadata?: ExecutionMetadata;
}
