"use client";

import {
  Children,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type LangTabProps = {
  label: string;
  children?: ReactNode;
};

export function LangTab(_props: LangTabProps) {
  // Rendered by LangTabs; this component only carries props + children.
  return null;
}
LangTab.displayName = "LangTab";

function isLangTab(child: unknown): child is ReactElement<LangTabProps> {
  if (!isValidElement(child)) return false;
  const type = child.type;
  if (type === LangTab) return true;
  if (typeof type === "string" && type === "LangTab") return true;
  if (
    typeof type === "function" &&
    "displayName" in type &&
    (type as { displayName?: string }).displayName === "LangTab"
  ) {
    return true;
  }
  const props = child.props as LangTabProps;
  return typeof props.label === "string" && "children" in props;
}

function collectTabs(children: ReactNode): Array<{ label: string; content: ReactNode }> {
  return Children.toArray(children)
    .filter(isLangTab)
    .map((child) => ({
      label: child.props.label,
      content: child.props.children,
    }));
}

export function LangTabs({
  children,
  ariaLabel = "Language",
}: {
  children: ReactNode;
  ariaLabel?: string;
}) {
  const tabs = collectTabs(children);
  const [active, setActive] = useState(0);
  const baseId = useId();

  if (!tabs.length) return null;

  const current = Math.min(active, tabs.length - 1);

  return (
    <div className="not-prose my-6 overflow-hidden rounded-ui border border-stone-200 dark:border-stone-800">
      <div
        className="flex flex-wrap gap-1 border-b border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900/60"
        role="tablist"
        aria-label={ariaLabel}
      >
        {tabs.map((tab, index) => {
          const selected = index === current;
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${index}`}
              onClick={() => setActive(index)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                selected
                  ? "bg-brandPrimary text-white"
                  : "text-stone-600 hover:bg-white hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-950 dark:hover:text-stone-50",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.label}
          role="tabpanel"
          id={`${baseId}-panel-${index}`}
          aria-labelledby={`${baseId}-tab-${index}`}
          hidden={index !== current}
          className={cn(
            "space-y-3 bg-white px-4 py-3 text-sm leading-relaxed text-stone-700 dark:bg-stone-950 dark:text-stone-300",
            // Force readable fenced blocks — parent `not-prose` skips article prose styles.
            "[&_pre]:my-0 [&_pre]:overflow-x-auto [&_pre]:rounded-ui [&_pre]:border [&_pre]:border-stone-800 [&_pre]:bg-stone-950 [&_pre]:p-4 [&_pre]:text-sm [&_pre]:text-stone-100",
            "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-stone-100 [&_pre_code]:shadow-none",
            "[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-stone-100 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-stone-800",
            "dark:[&_:not(pre)>code]:bg-stone-900 dark:[&_:not(pre)>code]:text-stone-100",
            "[&_a]:text-brandPrimary [&_a]:no-underline hover:[&_a]:underline",
            "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2",
          )}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
