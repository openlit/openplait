import type {
  DashboardDatasourceSpec,
  DashboardVariable,
  GridLayout,
  Panel,
  PanelLink,
} from "@openplait/core";

export interface PersesDashboardMetadata {
  name: string;
  project?: string;
  [key: string]: unknown;
}

export interface PersesDashboardSpec {
  display?: { name?: string; description?: string };
  datasources?: Record<string, DashboardDatasourceSpec>;
  variables?: DashboardVariable[];
  panels: Record<string, Panel>;
  layouts: GridLayout[];
  duration: string;
  refreshInterval?: string;
  links?: PanelLink[];
  [key: string]: unknown;
}

export interface PersesDashboard {
  kind: "Dashboard";
  metadata: PersesDashboardMetadata;
  spec: PersesDashboardSpec;
  [key: string]: unknown;
}

export type PersesCompatibilityCode =
  | "INVALID_PERSES_DASHBOARD"
  | "INVALID_OPENPLAIT_DASHBOARD"
  | "UNSUPPORTED_VISUALIZATION"
  | "QUERY_CONFLICT";

export interface PersesCompatibilityDiagnostic {
  code: PersesCompatibilityCode;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface PersesCompatibilityReport {
  compatible: boolean;
  diagnostics: PersesCompatibilityDiagnostic[];
}

export interface ExportPersesOptions {
  project?: string;
}
