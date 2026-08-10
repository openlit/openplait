import type { BooleanExpression, OrderByExpression, ValueExpression } from "./query.js";
import type { DataFieldType } from "./result.js";
import type { Resource, ScalarValue } from "./common.js";

export type ExecutionPreference = "auto" | "source" | "runtime" | "client";

export interface TransformationExecution {
  preference: ExecutionPreference;
}

export interface TransformationNode<TKind extends string, TSpec> {
  kind: TKind;
  spec: TSpec;
  execution?: TransformationExecution;
}

export type FilterRowsTransformation = TransformationNode<
  "FilterRows",
  { condition: BooleanExpression }
>;

export type SelectFieldsTransformation = TransformationNode<
  "SelectFields",
  { fields: string[] }
>;

export type RenameFieldsTransformation = TransformationNode<
  "RenameFields",
  { mappings: Record<string, string> }
>;

export type CalculateFieldTransformation = TransformationNode<
  "CalculateField",
  { as: string; expression: ValueExpression; type?: DataFieldType; unit?: string }
>;

export type SortTransformation = TransformationNode<
  "Sort",
  { by: OrderByExpression | OrderByExpression[] }
>;

export type LimitTransformation = TransformationNode<"Limit", { count: number }>;

export type ReduceFunction = "count" | "sum" | "avg" | "min" | "max" | "first" | "last";

export interface Reduction {
  field?: string;
  function: ReduceFunction;
  as: string;
}

export type GroupAndReduceTransformation = TransformationNode<
  "GroupAndReduce",
  { by?: string[]; reductions: Reduction[] }
>;

export type JoinFramesTransformation = TransformationNode<
  "JoinFrames",
  {
    left: string;
    right: string;
    on: string[];
    type?: "inner" | "left" | "full";
    as?: string;
  }
>;

export type MergeFramesTransformation = TransformationNode<
  "MergeFrames",
  { frames?: string[]; as?: string }
>;

export type PivotTransformation = TransformationNode<
  "Pivot",
  {
    index: string[];
    column: string;
    value: string;
    aggregation?: "first" | "last" | "sum" | "avg" | "min" | "max";
  }
>;

export type UnpivotTransformation = TransformationNode<
  "Unpivot",
  { fields: string[]; namesTo: string; valuesTo: string; keep?: string[] }
>;

export type ConvertUnitTransformation = TransformationNode<
  "ConvertUnit",
  { field: string; to: string; from?: string }
>;

export type FillMissingTransformation = TransformationNode<
  "FillMissing",
  {
    fields?: string[];
    strategy?: "constant" | "zero" | "previous" | "next";
    value?: ScalarValue;
  }
>;

export type WindowFunction = "movingAverage" | "runningSum" | "difference";

export type WindowCalculationTransformation = TransformationNode<
  "WindowCalculation",
  { field: string; as: string; function: WindowFunction; size?: number; unit?: string }
>;

export type LabelsToFieldsTransformation = TransformationNode<
  "LabelsToFields",
  { fields?: string[]; prefix?: string }
>;

export type ExtractJsonPropertyTransformation = TransformationNode<
  "ExtractJsonProperty",
  { field: string; path: string; as: string; type?: DataFieldType }
>;

export type Transformation =
  | FilterRowsTransformation
  | SelectFieldsTransformation
  | RenameFieldsTransformation
  | CalculateFieldTransformation
  | SortTransformation
  | LimitTransformation
  | GroupAndReduceTransformation
  | JoinFramesTransformation
  | MergeFramesTransformation
  | PivotTransformation
  | UnpivotTransformation
  | ConvertUnitTransformation
  | FillMissingTransformation
  | WindowCalculationTransformation
  | LabelsToFieldsTransformation
  | ExtractJsonPropertyTransformation;

export interface TransformationPipelineSpec {
  transformations: Transformation[];
}

export type TransformationPipeline = Resource<"TransformationPipeline", TransformationPipelineSpec>;
