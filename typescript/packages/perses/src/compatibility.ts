import {
  OPENPLAIT_API_VERSION,
  OpenPlaitValidationError,
  parseDocument,
  serializeDocument,
  validateDashboard,
  validateQuery,
  type Dashboard,
  type DashboardQueryDefinition,
  type DashboardVariable,
  type ExtensionMap,
  type Panel,
  type PanelQuery,
  type Plugin,
  type SerializationFormat,
  type Transformation,
} from "@openplait/core";

import type {
  ExportPersesOptions,
  PersesCompatibilityDiagnostic,
  PersesCompatibilityReport,
  PersesDashboard,
} from "./types.js";

const PRESERVATION_EXTENSION = "io.openplait.perses";
const OPENPLAIT_BRIDGE_EXTENSION = "io.openplait.dashboard";
const TRANSFORMATIONS_EXTENSION = "io.openplait.transformations";
const SUPPORTED_VISUALIZATIONS = new Set(["TimeSeriesChart", "StatChart", "Table"]);

interface PersesPreservation {
  project?: string;
  root?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  spec?: Record<string, unknown>;
}

export class PersesCompatibilityError extends Error {
  readonly diagnostics: PersesCompatibilityDiagnostic[];

  constructor(message: string, diagnostics: PersesCompatibilityDiagnostic[]) {
    super(message);
    this.name = "PersesCompatibilityError";
    this.diagnostics = diagnostics;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !excluded.has(key)));
}

function nonEmpty(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(record).length > 0 ? record : undefined;
}

function structuralDiagnostics(value: unknown): PersesCompatibilityDiagnostic[] {
  const diagnostics: PersesCompatibilityDiagnostic[] = [];
  const error = (path: string, message: string): void => {
    diagnostics.push({ code: "INVALID_PERSES_DASHBOARD", severity: "error", path, message });
  };

  if (!isRecord(value)) {
    error("/", "A Perses dashboard must be an object.");
    return diagnostics;
  }
  if (value.kind !== "Dashboard") error("/kind", "Perses resource kind must be 'Dashboard'.");
  if (!isRecord(value.metadata)) {
    error("/metadata", "Perses dashboard metadata must be an object.");
  } else if (typeof value.metadata.name !== "string" || value.metadata.name.length === 0) {
    error("/metadata/name", "Perses dashboard metadata.name is required.");
  }
  if (!isRecord(value.spec)) {
    error("/spec", "Perses dashboard spec must be an object.");
    return diagnostics;
  }
  if (!isRecord(value.spec.panels)) error("/spec/panels", "Perses dashboard panels must be an object.");
  if (!Array.isArray(value.spec.layouts)) error("/spec/layouts", "Perses dashboard layouts must be an array.");
  if (typeof value.spec.duration !== "string") error("/spec/duration", "Perses dashboard duration is required.");
  if (value.spec.datasources !== undefined && !isRecord(value.spec.datasources)) {
    error("/spec/datasources", "Perses dashboard datasources must be an object.");
  }
  if (value.spec.variables !== undefined && !Array.isArray(value.spec.variables)) {
    error("/spec/variables", "Perses dashboard variables must be an array.");
  }

  if (isRecord(value.spec.panels)) {
    for (const [name, panel] of Object.entries(value.spec.panels)) {
      if (!isRecord(panel) || panel.kind !== "Panel" || !isRecord(panel.spec)) {
        error(`/spec/panels/${name}`, "Each Perses panel must contain kind 'Panel' and an object spec.");
        continue;
      }
      if (!isRecord(panel.spec.plugin) || typeof panel.spec.plugin.kind !== "string" || !isRecord(panel.spec.plugin.spec)) {
        error(`/spec/panels/${name}/spec/plugin`, "Each Perses panel must declare a plugin kind and object spec.");
      }
      if (panel.spec.queries !== undefined && !Array.isArray(panel.spec.queries)) {
        error(`/spec/panels/${name}/spec/queries`, "Perses panel queries must be an array.");
      }
    }
  }

  if (Array.isArray(value.spec.variables)) {
    for (const [index, variable] of value.spec.variables.entries()) {
      if (!isRecord(variable) || !isRecord(variable.spec) || typeof variable.kind !== "string") {
        error(`/spec/variables/${index}`, "Each Perses variable must declare a kind and object spec.");
      }
    }
  }

  if (Array.isArray(value.spec.layouts)) {
    for (const [index, layout] of value.spec.layouts.entries()) {
      if (!isRecord(layout) || layout.kind !== "Grid" || !isRecord(layout.spec) || !Array.isArray(layout.spec.items)) {
        error(`/spec/layouts/${index}`, "Each supported Perses layout must be a Grid with an items array.");
      }
    }
  }

  return diagnostics;
}

function diagnosticFromCore(error: OpenPlaitValidationError): PersesCompatibilityDiagnostic[] {
  return error.errors.map(({ path, message }) => ({
    code: "INVALID_OPENPLAIT_DASHBOARD",
    severity: "error",
    path,
    message,
  }));
}

function preservationFrom(value: PersesDashboard): PersesPreservation {
  const root = nonEmpty(omit(value, ["kind", "metadata", "spec"]));
  const metadata = nonEmpty(omit(value.metadata, ["name", "project"]));
  const spec = nonEmpty(
    omit(value.spec, [
      "display",
      "datasources",
      "variables",
      "panels",
      "layouts",
      "duration",
      "refreshInterval",
      "links",
      "extensions",
    ]),
  );
  const preservation: PersesPreservation = {};
  if (value.metadata.project) preservation.project = value.metadata.project;
  if (root) preservation.root = clone(root);
  if (metadata) preservation.metadata = clone(metadata);
  if (spec) preservation.spec = clone(spec);
  return preservation;
}

function queryDefinitionFromPlugin(plugin: Plugin): {
  reference?: string;
  definition?: DashboardQueryDefinition;
  cleanPlugin: Plugin;
} {
  if (plugin.kind !== "OpenPlaitQuery" && plugin.kind !== "OpenPlaitVariableQuery") {
    return { cleanPlugin: clone(plugin) };
  }

  const spec = plugin.spec;
  const queryRef = isRecord(spec.queryRef) && typeof spec.queryRef.$ref === "string"
    ? spec.queryRef.$ref
    : undefined;
  const query = spec.query;
  const cleanSpec = omit(spec, ["query"]);
  const cleanPlugin: Plugin = { kind: plugin.kind, spec: cleanSpec };
  if (plugin.metadata) cleanPlugin.metadata = clone(plugin.metadata);
  if (!queryRef || !isRecord(query)) return { cleanPlugin };

  const name = queryRef.startsWith("#/spec/queries/")
    ? queryRef.slice("#/spec/queries/".length)
    : undefined;
  if (!name) return { cleanPlugin };

  const candidate = {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name },
    spec: query,
  };
  const result = validateQuery(candidate);
  if (!result.valid) return { cleanPlugin };
  return { reference: name, definition: { kind: "Query", spec: clone(result.value.spec) }, cleanPlugin };
}

function addDefinition(
  definitions: Record<string, DashboardQueryDefinition>,
  name: string | undefined,
  definition: DashboardQueryDefinition | undefined,
): void {
  if (!name || !definition) return;
  const current = definitions[name];
  if (current && JSON.stringify(current) !== JSON.stringify(definition)) {
    throw new PersesCompatibilityError("Perses dashboard contains conflicting OpenPlait query definitions.", [
      {
        code: "QUERY_CONFLICT",
        severity: "error",
        path: `#/spec/queries/${name}`,
        message: `Multiple embedded queries use '${name}' with different definitions.`,
      },
    ]);
  }
  definitions[name] = definition;
}

function importPanel(panel: Panel, definitions: Record<string, DashboardQueryDefinition>): Panel {
  const imported = clone(panel);
  const encodedTransformations = imported.spec.extensions?.[TRANSFORMATIONS_EXTENSION];
  if (Array.isArray(encodedTransformations)) {
    imported.spec.transformations = clone(encodedTransformations) as Transformation[];
    delete imported.spec.extensions![TRANSFORMATIONS_EXTENSION];
    if (Object.keys(imported.spec.extensions!).length === 0) delete imported.spec.extensions;
  }
  if (!imported.spec.queries) return imported;
  imported.spec.queries = imported.spec.queries.map((query): PanelQuery => {
    if (!("plugin" in query.spec)) return query;
    const extracted = queryDefinitionFromPlugin(query.spec.plugin);
    addDefinition(definitions, extracted.reference, extracted.definition);
    if (!extracted.reference || query.spec.plugin.kind !== "OpenPlaitQuery") {
      return { ...query, spec: { ...query.spec, plugin: extracted.cleanPlugin } };
    }
    const spec: { name?: string; queryRef: { $ref: string } } = {
      queryRef: { $ref: `#/spec/queries/${extracted.reference}` },
    };
    if (query.spec.name) spec.name = query.spec.name;
    return { kind: "OpenPlaitQuery", spec };
  });
  return imported;
}

function importVariable(
  variable: DashboardVariable,
  definitions: Record<string, DashboardQueryDefinition>,
): DashboardVariable {
  const imported = clone(variable);
  if (imported.kind !== "ListVariable") return imported;
  const extracted = queryDefinitionFromPlugin(imported.spec.plugin);
  addDefinition(definitions, extracted.reference, extracted.definition);
  imported.spec.plugin = extracted.cleanPlugin;
  return imported;
}

export function analyzePersesDashboard(value: unknown): PersesCompatibilityReport {
  const diagnostics = structuralDiagnostics(value);
  if (diagnostics.length > 0 || !isRecord(value) || !isRecord(value.spec) || !isRecord(value.spec.panels)) {
    return { compatible: false, diagnostics };
  }

  for (const [name, candidate] of Object.entries(value.spec.panels)) {
    if (!isRecord(candidate) || !isRecord(candidate.spec) || !isRecord(candidate.spec.plugin)) continue;
    const kind = candidate.spec.plugin.kind;
    if (typeof kind === "string" && !SUPPORTED_VISUALIZATIONS.has(kind)) {
      diagnostics.push({
        code: "UNSUPPORTED_VISUALIZATION",
        severity: "warning",
        path: `/spec/panels/${name}/spec/plugin/kind`,
        message: `Visualization plugin '${kind}' is preserved for round-trip export but has no portable renderer binding.`,
      });
    }
  }

  return { compatible: !diagnostics.some(({ severity }) => severity === "error"), diagnostics };
}

export function importPersesDashboard(value: unknown): Dashboard {
  const report = analyzePersesDashboard(value);
  if (!report.compatible || !isRecord(value) || !isRecord(value.metadata) || !isRecord(value.spec)) {
    throw new PersesCompatibilityError("Document is not an importable Perses dashboard.", report.diagnostics);
  }

  const source = value as PersesDashboard;
  const definitions: Record<string, DashboardQueryDefinition> = {};
  const panels = Object.fromEntries(
    Object.entries(source.spec.panels).map(([name, panel]) => [name, importPanel(panel, definitions)]),
  );
  const variables = source.spec.variables?.map((variable) => importVariable(variable, definitions));
  const preservation = preservationFrom(source);
  const sourceExtensions = isRecord(source.spec.extensions) ? clone(source.spec.extensions) : {};
  const bridge = isRecord(sourceExtensions[OPENPLAIT_BRIDGE_EXTENSION])
    ? sourceExtensions[OPENPLAIT_BRIDGE_EXTENSION]
    : undefined;
  delete sourceExtensions[OPENPLAIT_BRIDGE_EXTENSION];
  const extensions: ExtensionMap = { ...sourceExtensions };
  if (Object.keys(preservation).length > 0) extensions[PRESERVATION_EXTENSION] = preservation;
  const importedMetadata = bridge && isRecord(bridge.metadata) ? clone(bridge.metadata) : {};

  const dashboard: Dashboard = {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Dashboard",
    metadata: { ...importedMetadata, name: source.metadata.name },
    spec: {
      panels,
      layouts: clone(source.spec.layouts),
      duration: source.spec.duration,
    },
  };
  if (Object.keys(extensions).length > 0) dashboard.spec.extensions = extensions;
  if (source.spec.display) dashboard.spec.display = clone(source.spec.display);
  if (source.spec.datasources) dashboard.spec.datasources = clone(source.spec.datasources);
  if (variables) dashboard.spec.variables = variables;
  if (Object.keys(definitions).length > 0) dashboard.spec.queries = definitions;
  if (source.spec.refreshInterval) dashboard.spec.refreshInterval = source.spec.refreshInterval;
  if (source.spec.links) dashboard.spec.links = clone(source.spec.links);

  const validation = validateDashboard(dashboard);
  if (!validation.valid) {
    throw new PersesCompatibilityError(
      "Imported Perses dashboard is not a valid OpenPlait dashboard.",
      validation.errors.map(({ path, message }) => ({
        code: "INVALID_OPENPLAIT_DASHBOARD",
        severity: "error",
        path,
        message,
      })),
    );
  }
  return validation.value;
}

function preservationOf(dashboard: Dashboard): PersesPreservation {
  const candidate = dashboard.spec.extensions?.[PRESERVATION_EXTENSION];
  return isRecord(candidate) ? (candidate as PersesPreservation) : {};
}

function embeddedPlugin(plugin: Plugin, definitions: Record<string, DashboardQueryDefinition>): Plugin {
  if (plugin.kind !== "OpenPlaitVariableQuery") return clone(plugin);
  const queryRef = isRecord(plugin.spec.queryRef) && typeof plugin.spec.queryRef.$ref === "string"
    ? plugin.spec.queryRef.$ref
    : undefined;
  const name = queryRef?.startsWith("#/spec/queries/")
    ? queryRef.slice("#/spec/queries/".length)
    : undefined;
  const definition = name ? definitions[name] : undefined;
  if (!definition) return clone(plugin);
  return { ...clone(plugin), spec: { ...clone(plugin.spec), query: clone(definition.spec) } };
}

function exportPanel(panel: Panel, definitions: Record<string, DashboardQueryDefinition>): Panel {
  const exported = clone(panel);
  if (exported.spec.transformations) {
    exported.spec.extensions = {
      ...(exported.spec.extensions ?? {}),
      [TRANSFORMATIONS_EXTENSION]: clone(exported.spec.transformations),
    };
    delete exported.spec.transformations;
  }
  if (!exported.spec.queries) return exported;
  exported.spec.queries = exported.spec.queries.map((query): PanelQuery => {
    if (query.kind !== "OpenPlaitQuery" || !("queryRef" in query.spec)) return clone(query);
    const reference = query.spec.queryRef.$ref;
    const name = reference.startsWith("#/spec/queries/")
      ? reference.slice("#/spec/queries/".length)
      : undefined;
    const definition = name ? definitions[name] : undefined;
    const pluginSpec: Record<string, unknown> = { queryRef: clone(query.spec.queryRef) };
    if (definition) pluginSpec.query = clone(definition.spec);
    const spec: { name?: string; plugin: Plugin } = {
      plugin: { kind: "OpenPlaitQuery", spec: pluginSpec },
    };
    if (query.spec.name) spec.name = query.spec.name;
    return {
      kind: exported.spec.plugin.kind === "Table" ? "TableQuery" : "TimeSeriesQuery",
      spec,
    };
  });
  return exported;
}

export function exportPersesDashboard(
  dashboard: Dashboard,
  options: ExportPersesOptions = {},
): PersesDashboard {
  const validation = validateDashboard(dashboard);
  if (!validation.valid) {
    const wrapped = new OpenPlaitValidationError("Dashboard is not valid.", validation.errors);
    throw new PersesCompatibilityError("OpenPlait dashboard cannot be exported.", diagnosticFromCore(wrapped));
  }

  const source = validation.value;
  const preservation = preservationOf(source);
  const definitions = source.spec.queries ?? {};
  const extensions = clone(source.spec.extensions ?? {});
  delete extensions[PRESERVATION_EXTENSION];
  const portableMetadata = omit(source.metadata as unknown as Record<string, unknown>, ["name"]);
  if (Object.keys(portableMetadata).length > 0) {
    extensions[OPENPLAIT_BRIDGE_EXTENSION] = { metadata: portableMetadata };
  }

  const metadata: PersesDashboard["metadata"] = {
    ...(preservation.metadata ?? {}),
    name: source.metadata.name,
  };
  const project = options.project ?? preservation.project;
  if (project) metadata.project = project;

  const spec: PersesDashboard["spec"] = {
    ...(preservation.spec ?? {}),
    panels: Object.fromEntries(
      Object.entries(source.spec.panels).map(([name, panel]) => [name, exportPanel(panel, definitions)]),
    ),
    layouts: clone(source.spec.layouts),
    duration: source.spec.duration,
  };
  if (source.spec.display) spec.display = clone(source.spec.display);
  if (source.spec.datasources) spec.datasources = clone(source.spec.datasources);
  if (source.spec.variables) {
    spec.variables = source.spec.variables.map((variable): DashboardVariable => {
      const result = clone(variable);
      if (result.kind === "ListVariable") result.spec.plugin = embeddedPlugin(result.spec.plugin, definitions);
      return result;
    });
  }
  if (source.spec.refreshInterval) spec.refreshInterval = source.spec.refreshInterval;
  if (source.spec.links) spec.links = clone(source.spec.links);
  if (Object.keys(extensions).length > 0) spec.extensions = extensions;

  return {
    ...(preservation.root ?? {}),
    kind: "Dashboard",
    metadata,
    spec,
  };
}

export function parsePersesDashboard(source: string, format?: SerializationFormat): Dashboard {
  let parsed: unknown;
  try {
    parsed = parseDocument(source, format);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersesCompatibilityError(`Perses document could not be parsed: ${message}`, [
      { code: "INVALID_PERSES_DASHBOARD", severity: "error", path: "/", message },
    ]);
  }
  return importPersesDashboard(parsed);
}

export function serializePersesDashboard(
  dashboard: Dashboard,
  format: SerializationFormat = "yaml",
  options?: ExportPersesOptions,
): string {
  return serializeDocument(exportPersesDashboard(dashboard, options), format);
}
