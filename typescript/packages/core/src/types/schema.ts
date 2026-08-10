import type { ExtensionMap } from "./common.js";
import type { AggregateFunction, SignalType } from "./query.js";
import type { DataFieldType } from "./result.js";

export interface SemanticField {
  name: string;
  type: DataFieldType;
  unit?: string;
  description?: string;
  signals?: SignalType[];
}

export interface SemanticDataset {
  name: string;
  signal: SignalType;
  fields: SemanticField[];
  supportedAggregations?: AggregateFunction[];
  extensions?: ExtensionMap;
}

export interface SemanticSchema {
  datasets: SemanticDataset[];
}
