import type { OpenPlaitApiVersion } from "../version.js";

export interface ObjectMetadata {
  name: string;
  displayName?: string;
  description?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface Resource<TKind extends string, TSpec> {
  apiVersion: OpenPlaitApiVersion;
  kind: TKind;
  metadata: ObjectMetadata;
  spec: TSpec;
}

export interface DatasourceReference {
  kind: string;
  name: string;
  scope?: "dashboard" | "workspace" | "global";
}

export type ExtensionMap = Record<string, unknown>;

export type ScalarValue = string | number | boolean | null;

export type ParameterMap = Record<string, ScalarValue | ScalarValue[]>;
