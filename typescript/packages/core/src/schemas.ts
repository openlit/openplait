import alertRuleSchema from "../schemas/v1alpha1/alert-rule.schema.json" with { type: "json" };
import commonSchema from "../schemas/v1alpha1/common.schema.json" with { type: "json" };
import dashboardSchema from "../schemas/v1alpha1/dashboard.schema.json" with { type: "json" };
import queryResultSchema from "../schemas/v1alpha1/query-result.schema.json" with { type: "json" };
import querySchema from "../schemas/v1alpha1/query.schema.json" with { type: "json" };
import transformationPipelineSchema from "../schemas/v1alpha1/transformation-pipeline.schema.json" with { type: "json" };

export const schemas = {
  alertRule: alertRuleSchema,
  common: commonSchema,
  dashboard: dashboardSchema,
  query: querySchema,
  queryResult: queryResultSchema,
  transformationPipeline: transformationPipelineSchema,
} as const;

export type SchemaName = keyof typeof schemas;
