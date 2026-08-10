import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import formatsPlugin, { type FormatsPlugin } from "ajv-formats";

import { schemas } from "./schemas.js";
import type {
  AlertRule,
  Dashboard,
  DashboardVariable,
  OpenPlaitResource,
  Query,
  QueryResult,
  Transformation,
  TransformationPipeline,
} from "./types/index.js";

export type ValidationErrorCode =
  | "SCHEMA_VALIDATION_FAILED"
  | "UNSUPPORTED_KIND"
  | "DUPLICATE_OUTPUT_FIELD"
  | "FRAME_LENGTH_MISMATCH"
  | "DUPLICATE_VARIABLE"
  | "DUPLICATE_DEFAULT_DATASOURCE"
  | "DATASOURCE_NOT_FOUND"
  | "DATASOURCE_KIND_MISMATCH"
  | "TRANSFORMATION_INVALID"
  | "ALERT_INVALID"
  | "REFERENCE_NOT_FOUND"
  | "GRID_BOUNDS_EXCEEDED";

export interface ValidationError {
  code: ValidationErrorCode;
  path: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ValidationResult<T> =
  | { valid: true; value: T; errors: [] }
  | { valid: false; errors: ValidationError[] };

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: true,
});

(formatsPlugin as unknown as FormatsPlugin)(ajv);
ajv.addSchema(schemas.common);
ajv.addSchema(schemas.query);
ajv.addSchema(schemas.transformationPipeline);
ajv.addSchema(schemas.alertRule);

const queryValidator = ajv.getSchema(schemas.query.$id) as ValidateFunction<Query>;
const transformationPipelineValidator = ajv.getSchema(
  schemas.transformationPipeline.$id,
) as ValidateFunction<TransformationPipeline>;
const alertRuleValidator = ajv.getSchema(schemas.alertRule.$id) as ValidateFunction<AlertRule>;
const dashboardValidator = ajv.compile(
  schemas.dashboard,
) as ValidateFunction<Dashboard>;
const queryResultValidator = ajv.compile(
  schemas.queryResult,
) as ValidateFunction<QueryResult>;

function schemaErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  return (errors ?? []).map((error) => ({
    code: "SCHEMA_VALIDATION_FAILED",
    path: error.instancePath || "/",
    message: error.message ?? "Schema validation failed.",
    details: {
      keyword: error.keyword,
      ...error.params,
    },
  }));
}

function referencedName(reference: string, collection: "panels" | "queries"): string | undefined {
  const prefix = `#/spec/${collection}/`;
  return reference.startsWith(prefix) && reference.length > prefix.length
    ? reference.slice(prefix.length)
    : undefined;
}

function variableQueryReference(variable: DashboardVariable): string | undefined {
  if (variable.kind !== "ListVariable" || variable.spec.plugin.kind !== "OpenPlaitVariableQuery") {
    return undefined;
  }

  const queryRef = variable.spec.plugin.spec.queryRef;
  if (typeof queryRef !== "object" || queryRef === null || !("$ref" in queryRef)) return undefined;
  return typeof queryRef.$ref === "string" ? queryRef.$ref : undefined;
}

function transformationSemanticErrors(
  transformations: Transformation[],
  pathPrefix: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [index, transformation] of transformations.entries()) {
    const path = `${pathPrefix}/${index}`;
    if (transformation.kind === "RenameFields") {
      const targets = Object.values(transformation.spec.mappings);
      if (new Set(targets).size !== targets.length) {
        errors.push({
          code: "TRANSFORMATION_INVALID",
          path: `${path}/spec/mappings`,
          message: "RenameFields mappings must have unique target names.",
        });
      }
    }
    if (transformation.kind === "GroupAndReduce") {
      const outputs = transformation.spec.reductions.map(({ as }) => as);
      if (new Set(outputs).size !== outputs.length) {
        errors.push({
          code: "TRANSFORMATION_INVALID",
          path: `${path}/spec/reductions`,
          message: "GroupAndReduce reduction output names must be unique.",
        });
      }
    }
    if (
      transformation.kind === "JoinFrames" &&
      transformation.spec.left === transformation.spec.right
    ) {
      errors.push({
        code: "TRANSFORMATION_INVALID",
        path: `${path}/spec/right`,
        message: "JoinFrames requires two different frame names.",
      });
    }
    if (
      transformation.kind === "FillMissing" &&
      (transformation.spec.strategy ?? "constant") === "constant" &&
      !("value" in transformation.spec)
    ) {
      errors.push({
        code: "TRANSFORMATION_INVALID",
        path: `${path}/spec/value`,
        message: "FillMissing with the constant strategy requires a value.",
      });
    }
  }
  return errors;
}

function dashboardSemanticErrors(dashboard: Dashboard): ValidationError[] {
  const errors: ValidationError[] = [];
  const variables = new Map<string, number>();

  for (const [name, definition] of Object.entries(dashboard.spec.queries ?? {})) {
    const query: Query = {
      apiVersion: dashboard.apiVersion,
      kind: "Query",
      metadata: { name },
      spec: definition.spec,
    };
    errors.push(
      ...querySemanticErrors(query).map((error) => ({
        ...error,
        path: `/spec/queries/${name}${error.path}`,
      })),
    );

    const reference = definition.spec.datasource;
    if (reference.scope === "dashboard") {
      const datasource = dashboard.spec.datasources?.[reference.name];
      if (!datasource) {
        errors.push({
          code: "DATASOURCE_NOT_FOUND",
          path: `/spec/queries/${name}/spec/datasource/name`,
          message: `Dashboard datasource '${reference.name}' does not exist.`,
          details: { name: reference.name },
        });
      } else if (datasource.plugin.kind !== reference.kind) {
        errors.push({
          code: "DATASOURCE_KIND_MISMATCH",
          path: `/spec/queries/${name}/spec/datasource/kind`,
          message: `Query expects datasource kind '${reference.kind}', but '${reference.name}' uses '${datasource.plugin.kind}'.`,
          details: {
            name: reference.name,
            expectedKind: reference.kind,
            actualKind: datasource.plugin.kind,
          },
        });
      }
    }
  }

  for (const [index, variable] of (dashboard.spec.variables ?? []).entries()) {
    const previousIndex = variables.get(variable.spec.name);
    if (previousIndex !== undefined) {
      errors.push({
        code: "DUPLICATE_VARIABLE",
        path: `/spec/variables/${index}/spec/name`,
        message: `Variable '${variable.spec.name}' duplicates variable ${previousIndex}.`,
        details: { name: variable.spec.name, previousIndex },
      });
    } else {
      variables.set(variable.spec.name, index);
    }

    const reference = variableQueryReference(variable);
    if (reference) {
      const queryName = referencedName(reference, "queries");
      if (!queryName || !dashboard.spec.queries?.[queryName]) {
        errors.push({
          code: "REFERENCE_NOT_FOUND",
          path: `/spec/variables/${index}/spec/plugin/spec/queryRef/$ref`,
          message: `Variable query reference '${reference}' does not resolve to a dashboard query.`,
          details: { reference },
        });
      }
    }
  }

  const defaultDatasources = new Map<string, string>();
  for (const [name, datasource] of Object.entries(dashboard.spec.datasources ?? {})) {
    if (!datasource.default) continue;
    const previousName = defaultDatasources.get(datasource.plugin.kind);
    if (previousName) {
      errors.push({
        code: "DUPLICATE_DEFAULT_DATASOURCE",
        path: `/spec/datasources/${name}/default`,
        message: `Datasource '${name}' and '${previousName}' are both default for plugin kind '${datasource.plugin.kind}'.`,
        details: { kind: datasource.plugin.kind, previousName },
      });
    } else {
      defaultDatasources.set(datasource.plugin.kind, name);
    }
  }

  for (const [panelName, panel] of Object.entries(dashboard.spec.panels)) {
    errors.push(
      ...transformationSemanticErrors(
        panel.spec.transformations ?? [],
        `/spec/panels/${panelName}/spec/transformations`,
      ),
    );
    for (const [queryIndex, query] of (panel.spec.queries ?? []).entries()) {
      if (query.kind !== "OpenPlaitQuery" || !("queryRef" in query.spec)) continue;
      const reference = query.spec.queryRef.$ref;
      const queryName = referencedName(reference, "queries");
      if (!queryName || !dashboard.spec.queries?.[queryName]) {
        errors.push({
          code: "REFERENCE_NOT_FOUND",
          path: `/spec/panels/${panelName}/spec/queries/${queryIndex}/spec/queryRef/$ref`,
          message: `Panel query reference '${reference}' does not resolve to a dashboard query.`,
          details: { reference },
        });
      }
    }
  }

  for (const [layoutIndex, layout] of dashboard.spec.layouts.entries()) {
    if (layout.spec.repeatVariable && !variables.has(layout.spec.repeatVariable)) {
      errors.push({
        code: "REFERENCE_NOT_FOUND",
        path: `/spec/layouts/${layoutIndex}/spec/repeatVariable`,
        message: `Repeat variable '${layout.spec.repeatVariable}' is not declared by the dashboard.`,
        details: { reference: layout.spec.repeatVariable },
      });
    }

    for (const [itemIndex, item] of layout.spec.items.entries()) {
      if (item.x + item.width > 24) {
        errors.push({
          code: "GRID_BOUNDS_EXCEEDED",
          path: `/spec/layouts/${layoutIndex}/spec/items/${itemIndex}`,
          message: `Grid item ends at column ${item.x + item.width}, beyond the 24-column grid.`,
          details: { x: item.x, width: item.width, columns: 24 },
        });
      }

      const reference = item.content.$ref;
      const panelName = referencedName(reference, "panels");
      if (!panelName || !dashboard.spec.panels[panelName]) {
        errors.push({
          code: "REFERENCE_NOT_FOUND",
          path: `/spec/layouts/${layoutIndex}/spec/items/${itemIndex}/content/$ref`,
          message: `Layout reference '${reference}' does not resolve to a dashboard panel.`,
          details: { reference },
        });
      }
    }
  }

  return errors;
}

function outputName(query: Query, index: number): string | undefined {
  if (query.spec.mode !== "semantic") return undefined;

  const selected = query.spec.select[index];
  if (!selected) return undefined;
  if ("as" in selected && selected.as) return selected.as;
  if ("field" in selected) return selected.field;
  return undefined;
}

function querySemanticErrors(query: Query): ValidationError[] {
  if (query.spec.mode !== "semantic") return [];

  const errors: ValidationError[] = [];
  const outputNames = new Map<string, number>();

  for (const [index] of query.spec.select.entries()) {
    const name = outputName(query, index);
    if (!name) continue;

    const previousIndex = outputNames.get(name);
    if (previousIndex !== undefined) {
      errors.push({
        code: "DUPLICATE_OUTPUT_FIELD",
        path: `/spec/select/${index}`,
        message: `Output field '${name}' duplicates select item ${previousIndex}.`,
        details: { name, previousIndex },
      });
    } else {
      outputNames.set(name, index);
    }
  }

  return errors;
}

export function validateQuery(value: unknown): ValidationResult<Query> {
  if (!queryValidator(value)) {
    return { valid: false, errors: schemaErrors(queryValidator.errors) };
  }

  const errors = querySemanticErrors(value);
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value, errors: [] };
}

export function validateDashboard(value: unknown): ValidationResult<Dashboard> {
  if (!dashboardValidator(value)) {
    return { valid: false, errors: schemaErrors(dashboardValidator.errors) };
  }

  const errors = dashboardSemanticErrors(value);
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value, errors: [] };
}

export function validateTransformationPipeline(
  value: unknown,
): ValidationResult<TransformationPipeline> {
  if (!transformationPipelineValidator(value)) {
    return { valid: false, errors: schemaErrors(transformationPipelineValidator.errors) };
  }
  const errors = transformationSemanticErrors(value.spec.transformations, "/spec/transformations");
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value, errors: [] };
}

export function validateAlertRule(value: unknown): ValidationResult<AlertRule> {
  if (!alertRuleValidator(value)) {
    return { valid: false, errors: schemaErrors(alertRuleValidator.errors) };
  }
  const query: Query = {
    apiVersion: value.apiVersion,
    kind: "Query",
    metadata: { name: `${value.metadata.name}-query` },
    spec: value.spec.query.spec,
  };
  const errors = [
    ...querySemanticErrors(query).map((error) => ({
      ...error,
      path: `/spec/query${error.path}`,
    })),
    ...transformationSemanticErrors(value.spec.transformations ?? [], "/spec/transformations"),
  ];
  for (const [index, transformation] of (value.spec.transformations ?? []).entries()) {
    if (transformation.execution?.preference === "client") {
      errors.push({
        code: "ALERT_INVALID",
        path: `/spec/transformations/${index}/execution/preference`,
        message: "Alert evaluation cannot defer transformations to a client.",
      });
    }
  }
  for (const property of ["every", "lookback"] as const) {
    const duration = value.spec.evaluation[property];
    if (duration?.startsWith("0")) {
      errors.push({
        code: "ALERT_INVALID",
        path: `/spec/evaluation/${property}`,
        message: `Alert evaluation ${property} must be greater than zero.`,
      });
    }
  }
  const channels = new Set<string>();
  for (const [index, notification] of (value.spec.notifications ?? []).entries()) {
    if (channels.has(notification.channelRef)) {
      errors.push({
        code: "ALERT_INVALID",
        path: `/spec/notifications/${index}/channelRef`,
        message: `Notification channel '${notification.channelRef}' is duplicated.`,
      });
    }
    channels.add(notification.channelRef);
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value, errors: [] };
}

export function validateQueryResult(value: unknown): ValidationResult<QueryResult> {
  if (!queryResultValidator(value)) {
    return { valid: false, errors: schemaErrors(queryResultValidator.errors) };
  }

  const errors: ValidationError[] = [];
  for (const [frameIndex, frame] of value.frames.entries()) {
    for (const [fieldIndex, field] of frame.fields.entries()) {
      if (field.values.length !== frame.length) {
        errors.push({
          code: "FRAME_LENGTH_MISMATCH",
          path: `/frames/${frameIndex}/fields/${fieldIndex}/values`,
          message: `Field '${field.name}' has ${field.values.length} values but the frame length is ${frame.length}.`,
          details: {
            fieldLength: field.values.length,
            frameLength: frame.length,
          },
        });
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value, errors: [] };
}

export function validateResource(value: unknown): ValidationResult<OpenPlaitResource> {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return {
      valid: false,
      errors: [
        {
          code: "SCHEMA_VALIDATION_FAILED",
          path: "/kind",
          message: "A resource kind is required.",
        },
      ],
    };
  }

  if (value.kind === "Query") return validateQuery(value);
  if (value.kind === "Dashboard") return validateDashboard(value);
  if (value.kind === "TransformationPipeline") return validateTransformationPipeline(value);
  if (value.kind === "AlertRule") return validateAlertRule(value);

  return {
    valid: false,
    errors: [
      {
        code: "UNSUPPORTED_KIND",
        path: "/kind",
        message: `Resource kind '${String(value.kind)}' is not supported by this version.`,
      },
    ],
  };
}
