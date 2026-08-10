import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white dark:bg-stone-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(243,108,6,0.10),transparent_42%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.06),transparent_40%)]" />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-4 pb-12 pt-14 text-center md:pt-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/openplait-mark.svg"
          alt="OpenPlait"
          width={64}
          height={64}
          className="mb-5"
        />
        <h1 className="text-balance text-4xl font-bold tracking-tight text-stone-900 dark:text-white sm:text-5xl md:text-6xl">
          OpenPlait
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-stone-700 dark:text-stone-300 md:text-lg">
          One portable query contract for every observability datasource —
          compile once, normalize everywhere.
        </p>
        <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <Link
            href="/getting-started/"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-ui bg-brandPrimary px-6 text-sm font-medium text-white transition hover:bg-primary-700 sm:h-10"
          >
            Documentation
            <span aria-hidden="true">→</span>
          </Link>
          <a
            href="https://github.com/openlit/openplait"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-ui border border-stone-200 bg-white px-6 text-sm font-medium text-stone-900 transition hover:border-brandPrimary/40 dark:border-stone-700 dark:bg-stone-950 dark:text-white sm:h-10"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
