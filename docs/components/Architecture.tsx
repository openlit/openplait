export function Architecture() {
  return (
    <section className="py-12 md:py-16">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white md:text-3xl">
          Intent in. Portable frames out.
        </h2>
        <p className="mt-3 text-stone-600 dark:text-stone-400">
          Adapters own compilation and execution. Applications own credentials, routing,
          and presentation.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[0.85fr_1.3fr_0.85fr]">
        <Column
          label="Applications"
          nodes={["OpenLIT", "Dashboards", "Alert engines"]}
        />
        <Column
          label="OpenPlait"
          accent
          nodes={["Query IR + validation", "Datasource registry + runtime", "Normalized dataframes"]}
        />
        <Column
          label="Backends"
          nodes={["ClickHouse", "Tempo · Loki · Prometheus", "Jaeger"]}
        />
      </div>
    </section>
  );
}

function Column({
  label,
  nodes,
  accent = false,
}: {
  label: string;
  nodes: string[];
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "flex flex-col justify-center gap-2 rounded-ui border border-brandPrimary/30 bg-brandPrimary/5 p-4"
          : "flex flex-col justify-center gap-2 rounded-ui border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950"
      }
    >
      <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
        {label}
      </div>
      {nodes.map((node) => (
        <div
          key={node}
          className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-center text-sm font-medium text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
        >
          {node}
        </div>
      ))}
    </div>
  );
}
