import Link from "next/link";
import { HeroSection } from "@/components/HeroSection";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Architecture } from "@/components/Architecture";
import { QuickStart } from "@/components/QuickStart";

export default function HomePage() {
  return (
    <div className="min-h-[100dvh] bg-white dark:bg-stone-950">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <div className="mx-auto flex h-11 w-full max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/openplait-mark.svg" alt="" width={22} height={22} />
            <span className="text-sm font-semibold tracking-tight">OpenPlait</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/getting-started/"
              className="rounded-ui px-3 py-1.5 text-sm text-stone-600 transition hover:text-stone-900 dark:text-stone-300"
            >
              Docs
            </Link>
            <a
              href="https://github.com/openlit/openplait"
              target="_blank"
              rel="noreferrer"
              className="rounded-ui border border-stone-200 px-3 py-1.5 text-sm dark:border-stone-700"
            >
              GitHub
            </a>
            <Link
              href="/getting-started/"
              className="rounded-ui bg-brandPrimary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <HeroSection />
        <div className="mx-auto max-w-6xl px-4 pb-16">
          <FeatureGrid />
          <Architecture />
          <QuickStart />
        </div>
      </main>
    </div>
  );
}
