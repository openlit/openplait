const features = [
  {
    title: "Portable Query IR",
    description:
      "Describe intent with semantic fields, filters, grouping, time ranges, and limits instead of backend syntax.",
  },
  {
    title: "Normalized dataframes",
    description:
      "Every adapter emits the same typed, columnar result contract for tables, charts, alerts, and analysis.",
  },
  {
    title: "Multiple datasources",
    description:
      "Resolve named datasource instances by scope without putting credentials or vendor details into dashboards.",
  },
  {
    title: "ClickHouse, Tempo, Loki, Prometheus, Jaeger",
    description:
      "Ship with first-party adapters for OpenTelemetry stores and Grafana-style backends — including Jaeger Query HTTP.",
  },
  {
    title: "Native escape hatches",
    description:
      "Keep TraceQL, LogQL, PromQL, and SQL available when semantic mode is not enough.",
  },
  {
    title: "Application-neutral",
    description:
      "OpenLIT owns vault, SSRF, and product UI. OpenPlait stays a portable contract any host can adopt.",
  },
];

export function FeatureGrid() {
  return (
    <section className="py-12 md:py-16">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white md:text-3xl">
          Built for one contract across backends
        </h2>
        <p className="mt-3 text-stone-600 dark:text-stone-400">
          OpenPlait separates product intent from datasource execution without hiding
          native capabilities when you need them.
        </p>
      </div>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <article
            key={feature.title}
            className="border-t border-stone-200 py-5 transition hover:border-brandPrimary dark:border-stone-800"
          >
            <h3 className="text-base font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              {feature.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              {feature.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
