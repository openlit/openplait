"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DOCS_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

type LayoutState = {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

const LayoutContext = createContext<LayoutState | null>(null);

export function useDocsLayout() {
  const value = useContext(LayoutContext);
  if (!value) throw new Error("useDocsLayout must be used within DocsShell");
  return value;
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/openplait-mark.svg" alt="" width={24} height={24} />
      <span className="text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        OpenPlait
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-6 pt-2">
      {DOCS_NAV.map((group) => (
        <div key={group.title}>
          <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
            {group.title}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                pathname === item.href ||
                pathname === item.href.replace(/\/$/, "") ||
                `${pathname}/` === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "block rounded-ui px-2.5 py-1.5 text-sm transition",
                      active
                        ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-900 dark:text-white"
                        : "text-stone-600 hover:bg-stone-50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-50",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function HeaderBar() {
  const pathname = usePathname();
  const { setMobileOpen } = useDocsLayout();
  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return [{ label: "Home", href: "/" }];
    const items = [{ label: "Docs", href: "/getting-started/" }];
    let href = "";
    for (const part of parts) {
      href += `/${part}`;
      items.push({
        label: part.replace(/-/g, " "),
        href: `${href}/`,
      });
    }
    return items;
  }, [pathname]);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 bg-white px-3 dark:bg-stone-950 md:px-4">
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-ui border border-stone-200 text-stone-700 md:hidden dark:border-stone-700 dark:text-stone-200"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        ☰
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.href}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <span className="text-stone-300 dark:text-stone-700">/</span>}
            <Link
              href={crumb.href}
              className={cn(
                "truncate capitalize",
                index === crumbs.length - 1
                  ? "font-semibold text-stone-900 dark:text-stone-50"
                  : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
              )}
            >
              {crumb.label}
            </Link>
          </span>
        ))}
      </div>
      <a
        href="https://github.com/openlit/openplait"
        target="_blank"
        rel="noreferrer"
        className="hidden rounded-ui border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:border-brandPrimary/40 sm:inline-flex dark:border-stone-700 dark:text-stone-200"
      >
        GitHub
      </a>
      <Link
        href="/getting-started/"
        className="inline-flex h-8 items-center rounded-ui bg-brandPrimary px-3 text-xs font-medium text-white transition hover:bg-primary-700"
      >
        Get started
      </Link>
    </header>
  );
}

export function DocsShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <LayoutContext.Provider value={{ mobileOpen, setMobileOpen }}>
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white dark:bg-stone-950">
        <div className="flex shrink-0 border-b border-stone-200 dark:border-stone-800">
          <div className="hidden w-64 shrink-0 border-r border-stone-200 dark:border-stone-800 md:block">
            <Brand />
          </div>
          <div className="min-w-0 flex-1">
            <HeaderBar />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 flex-col border-r border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950 md:flex">
            <SidebarNav />
            <div className="border-t border-stone-200 px-3 py-3 text-xs text-stone-500 dark:border-stone-800">
              Portable observability infrastructure
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto bg-white dark:bg-stone-950">
            {children}
          </main>
        </div>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-stone-950/40"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl dark:bg-stone-950">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800">
                <Brand />
                <button
                  type="button"
                  className="mr-3 rounded-ui border border-stone-200 px-2 py-1 text-sm dark:border-stone-700"
                  onClick={() => setMobileOpen(false)}
                >
                  Close
                </button>
              </div>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </LayoutContext.Provider>
  );
}
