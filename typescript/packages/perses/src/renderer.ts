import {
  validateDashboard,
  type Dashboard,
  type DashboardDatasourceSpec,
  type DashboardVariable,
  type GridItem,
  type Panel,
  type PanelLink,
  type PanelQuery,
  type Plugin,
  type QuerySpec,
  type Transformation,
} from "@openplait/core";

export type RendererPanelKind = "timeSeries" | "stat" | "table";

export type RendererQueryBinding =
  | {
      source: "openplait";
      name?: string;
      queryRef: string;
      query: QuerySpec;
    }
  | {
      source: "plugin";
      name?: string;
      kind: string;
      plugin: Plugin;
    };

export interface RendererPanelBinding {
  key: string;
  kind: RendererPanelKind;
  title?: string;
  description?: string;
  visualization: Record<string, unknown>;
  queries: RendererQueryBinding[];
  transformations: Transformation[];
  links?: PanelLink[];
}

export interface RendererGridItem extends Omit<GridItem, "content"> {
  panel: RendererPanelBinding;
}

export interface RendererSection {
  title?: string;
  collapsed?: boolean;
  repeatVariable?: string;
  items: RendererGridItem[];
}

export interface DashboardRenderModel {
  name: string;
  title?: string;
  description?: string;
  duration: string;
  refreshInterval?: string;
  datasources: Record<string, DashboardDatasourceSpec>;
  variables: DashboardVariable[];
  sections: RendererSection[];
}

export class RendererBindingError extends Error {
  readonly code: "INVALID_DASHBOARD" | "UNSUPPORTED_VISUALIZATION" | "REFERENCE_NOT_FOUND";
  readonly path: string;

  constructor(
    code: RendererBindingError["code"],
    path: string,
    message: string,
  ) {
    super(message);
    this.name = "RendererBindingError";
    this.code = code;
    this.path = path;
  }
}

const RENDERER_KINDS: Record<string, RendererPanelKind> = {
  TimeSeriesChart: "timeSeries",
  StatChart: "stat",
  Table: "table",
};

function panelQueries(dashboard: Dashboard, panelKey: string, queries: PanelQuery[]): RendererQueryBinding[] {
  return queries.map((query, index): RendererQueryBinding => {
    if (query.kind === "OpenPlaitQuery" && "queryRef" in query.spec) {
      const reference = query.spec.queryRef.$ref;
      const prefix = "#/spec/queries/";
      const name = reference.startsWith(prefix) ? reference.slice(prefix.length) : undefined;
      const definition = name ? dashboard.spec.queries?.[name] : undefined;
      if (!definition) {
        throw new RendererBindingError(
          "REFERENCE_NOT_FOUND",
          `/spec/panels/${panelKey}/spec/queries/${index}/spec/queryRef/$ref`,
          `Panel query '${reference}' does not resolve.`,
        );
      }
      const binding: RendererQueryBinding = {
        source: "openplait",
        queryRef: reference,
        query: structuredClone(definition.spec),
      };
      if (query.spec.name) binding.name = query.spec.name;
      return binding;
    }

    if (!("plugin" in query.spec)) {
      throw new RendererBindingError(
        "INVALID_DASHBOARD",
        `/spec/panels/${panelKey}/spec/queries/${index}`,
        "Panel query has no renderer-compatible query definition.",
      );
    }
    const binding: RendererQueryBinding = {
      source: "plugin",
      kind: query.kind,
      plugin: structuredClone(query.spec.plugin),
    };
    if (query.spec.name) binding.name = query.spec.name;
    return binding;
  });
}

export function bindPanel(dashboard: Dashboard, panelKey: string, panel: Panel): RendererPanelBinding {
  const kind = RENDERER_KINDS[panel.spec.plugin.kind];
  if (!kind) {
    throw new RendererBindingError(
      "UNSUPPORTED_VISUALIZATION",
      `/spec/panels/${panelKey}/spec/plugin/kind`,
      `No portable renderer binding exists for '${panel.spec.plugin.kind}'.`,
    );
  }

  const binding: RendererPanelBinding = {
    key: panelKey,
    kind,
    visualization: structuredClone(panel.spec.plugin.spec),
    queries: panelQueries(dashboard, panelKey, panel.spec.queries ?? []),
    transformations: structuredClone(panel.spec.transformations ?? []),
  };
  if (panel.spec.display?.name) binding.title = panel.spec.display.name;
  if (panel.spec.display?.description) binding.description = panel.spec.display.description;
  if (panel.spec.links) binding.links = structuredClone(panel.spec.links);
  return binding;
}

export function createDashboardRenderModel(dashboard: Dashboard): DashboardRenderModel {
  const validation = validateDashboard(dashboard);
  if (!validation.valid) {
    const first = validation.errors[0];
    throw new RendererBindingError(
      "INVALID_DASHBOARD",
      first?.path ?? "/",
      first?.message ?? "Dashboard is invalid.",
    );
  }

  const source = validation.value;
  const sections = source.spec.layouts.map((layout, layoutIndex): RendererSection => {
    const section: RendererSection = {
      items: layout.spec.items.map((item, itemIndex): RendererGridItem => {
        const prefix = "#/spec/panels/";
        const reference = item.content.$ref;
        const panelKey = reference.startsWith(prefix) ? reference.slice(prefix.length) : undefined;
        const panel = panelKey ? source.spec.panels[panelKey] : undefined;
        if (!panelKey || !panel) {
          throw new RendererBindingError(
            "REFERENCE_NOT_FOUND",
            `/spec/layouts/${layoutIndex}/spec/items/${itemIndex}/content/$ref`,
            `Layout item '${reference}' does not resolve.`,
          );
        }
        return {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          panel: bindPanel(source, panelKey, panel),
        };
      }),
    };
    if (layout.spec.display?.title) section.title = layout.spec.display.title;
    if (layout.spec.display?.collapse) section.collapsed = !layout.spec.display.collapse.open;
    if (layout.spec.repeatVariable) section.repeatVariable = layout.spec.repeatVariable;
    return section;
  });

  const model: DashboardRenderModel = {
    name: source.metadata.name,
    duration: source.spec.duration,
    datasources: structuredClone(source.spec.datasources ?? {}),
    variables: structuredClone(source.spec.variables ?? []),
    sections,
  };
  if (source.spec.display?.name) model.title = source.spec.display.name;
  if (source.spec.display?.description) model.description = source.spec.display.description;
  if (source.spec.refreshInterval) model.refreshInterval = source.spec.refreshInterval;
  return model;
}
