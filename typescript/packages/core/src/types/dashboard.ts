import type { ExtensionMap, Resource, ScalarValue } from "./common.js";
import type { QuerySpec } from "./query.js";
import type { Transformation } from "./transformation.js";

export interface Display {
  name?: string;
  description?: string;
}

export interface PluginMetadata {
  version?: string;
  registry?: string;
}

export interface Plugin<TSpec = Record<string, unknown>> {
  kind: string;
  spec: TSpec;
  metadata?: PluginMetadata;
}

export interface JsonReference {
  $ref: string;
}

export interface DashboardDatasourceSpec {
  display?: Display;
  default?: boolean;
  plugin: Plugin;
}

export interface VariableDisplay extends Display {
  hidden?: boolean;
}

export interface TextVariable {
  kind: "TextVariable";
  spec: {
    name: string;
    display?: VariableDisplay;
    value: string;
    constant?: boolean;
  };
}

export type VariableSort =
  | "none"
  | "alphabetical-asc"
  | "alphabetical-desc"
  | "numerical-asc"
  | "numerical-desc"
  | "alphabetical-ci-asc"
  | "alphabetical-ci-desc";

export interface ListVariable {
  kind: "ListVariable";
  spec: {
    name: string;
    display?: VariableDisplay;
    defaultValue?: string | string[];
    allowAllValue?: boolean;
    allowMultiple?: boolean;
    customAllValue?: string;
    capturingRegexp?: string;
    sort?: VariableSort;
    plugin: Plugin;
  };
}

export type DashboardVariable = TextVariable | ListVariable;

export interface DashboardQueryDefinition {
  kind: "Query";
  spec: QuerySpec;
}

export interface OpenPlaitPanelQuery {
  kind: "OpenPlaitQuery";
  spec: {
    name?: string;
    queryRef: JsonReference;
  };
}

export interface PluginPanelQuery {
  kind: string;
  spec: {
    name?: string;
    plugin: Plugin;
  };
}

export type PanelQuery = OpenPlaitPanelQuery | PluginPanelQuery;

export interface PanelLink {
  name?: string;
  url: string;
  tooltip?: string;
  renderVariables?: boolean;
  targetBlank?: boolean;
}

export interface TimeSeriesVisualizationSpec {
  dataMapping?: {
    timeField?: string;
    valueFields?: string[];
    seriesField?: string;
  };
  display?: {
    legend?: { position?: "top" | "bottom" | "left" | "right" | "hidden" };
    yAxis?: { unit?: string; min?: number; max?: number };
    lineWidth?: number;
    showPoints?: boolean;
  };
  interactions?: Record<string, unknown>;
  extensions?: ExtensionMap;
}

export interface StatVisualizationSpec {
  dataMapping?: { valueField?: string };
  display?: {
    unit?: string;
    decimals?: number;
    colorMode?: "value" | "background" | "none";
  };
  calculation?: "first" | "last" | "min" | "max" | "mean" | "sum";
  interactions?: Record<string, unknown>;
  extensions?: ExtensionMap;
}

export interface TableVisualizationSpec {
  dataMapping?: { fields?: string[] };
  display?: {
    density?: "compact" | "standard" | "comfortable";
    showHeader?: boolean;
  };
  interactions?: Record<string, unknown>;
  extensions?: ExtensionMap;
}

export type SupportedVisualizationPlugin =
  | { kind: "TimeSeriesChart"; spec: TimeSeriesVisualizationSpec }
  | { kind: "StatChart"; spec: StatVisualizationSpec }
  | { kind: "Table"; spec: TableVisualizationSpec };

export interface Panel {
  kind: "Panel";
  spec: {
    display?: Display;
    plugin: Plugin;
    queries?: PanelQuery[];
    transformations?: Transformation[];
    links?: PanelLink[];
    extensions?: ExtensionMap;
  };
}

export interface GridItem {
  x: number;
  y: number;
  width: number;
  height: number;
  content: JsonReference;
}

export interface GridLayout {
  kind: "Grid";
  spec: {
    display?: {
      title?: string;
      collapse?: { open: boolean };
    };
    items: GridItem[];
    repeatVariable?: string;
  };
}

export interface DashboardSpec {
  display?: Display;
  datasources?: Record<string, DashboardDatasourceSpec>;
  variables?: DashboardVariable[];
  queries?: Record<string, DashboardQueryDefinition>;
  panels: Record<string, Panel>;
  layouts: GridLayout[];
  duration: string;
  refreshInterval?: string;
  links?: PanelLink[];
  extensions?: ExtensionMap;
}

export type Dashboard = Resource<"Dashboard", DashboardSpec>;

export type DashboardParameterValue = ScalarValue | ScalarValue[];
