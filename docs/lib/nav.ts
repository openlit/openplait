export type DocsNavItem = {
  title: string;
  href: string;
};

export type DocsNavGroup = {
  title: string;
  items: DocsNavItem[];
};

export const DOCS_NAV: DocsNavGroup[] = [
  {
    title: "Start",
    items: [{ title: "Getting Started", href: "/getting-started/" }],
  },
  {
    title: "Core Concepts",
    items: [
      { title: "Architecture", href: "/concepts/architecture/" },
      { title: "Query Model", href: "/concepts/query-model/" },
      { title: "Dataframes", href: "/concepts/dataframes/" },
      { title: "Datasource Routing", href: "/concepts/datasource-routing/" },
    ],
  },
  {
    title: "Adapters",
    items: [
      { title: "Overview", href: "/adapters/overview/" },
      { title: "ClickHouse", href: "/adapters/clickhouse/" },
      { title: "Jaeger", href: "/adapters/jaeger/" },
      { title: "Grafana Loki", href: "/adapters/loki/" },
      { title: "Prometheus", href: "/adapters/prometheus/" },
      { title: "Grafana Tempo", href: "/adapters/tempo/" },
      { title: "Build an Adapter", href: "/adapters/custom/" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Agent Skills", href: "/guides/agent-skills/" },
      { title: "Multiple Datasources", href: "/guides/multiple-datasources/" },
      { title: "Native Queries", href: "/guides/native-queries/" },
      { title: "OpenLIT Integration", href: "/guides/openlit/" },
      { title: "Python", href: "/guides/python/" },
      { title: "TypeScript", href: "/guides/typescript/" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "Examples", href: "/examples/" },
      { title: "@openplait/core", href: "/reference/core/" },
      { title: "@openplait/adapter-sdk", href: "/reference/adapter-sdk/" },
      { title: "@openplait/runtime", href: "/reference/runtime/" },
      { title: "Brand", href: "/brand/" },
    ],
  },
];

export function flattenNav(): DocsNavItem[] {
  return DOCS_NAV.flatMap((group) => group.items);
}

export function findNavNeighbors(pathname: string) {
  const flat = flattenNav();
  const index = flat.findIndex(
    (item) => item.href === pathname || item.href === `${pathname}/`,
  );
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index >= 0 && index < flat.length - 1 ? flat[index + 1] : null,
  };
}
