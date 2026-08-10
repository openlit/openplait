import Link from "next/link";
import type { ImgHTMLAttributes } from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import type { DocPage } from "@/lib/docs";
import { findNavNeighbors } from "@/lib/nav";
import { hrefForSlug } from "@/lib/docs";
import { LangTab, LangTabs } from "@/components/LangTabs";

const components = {
  img: (props: ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt || ""} className="rounded-ui border border-stone-200 dark:border-stone-800" />
  ),
  LangTabs,
  LangTab,
};

export function DocArticle({ doc }: { doc: DocPage }) {
  const href = hrefForSlug(doc.slug);
  const { prev, next } = findNavNeighbors(href);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8 md:py-10">
      <div className="mb-8 border-b border-stone-200 pb-6 dark:border-stone-800">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-brandPrimary">
          Documentation
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50 md:text-4xl">
          {doc.title}
        </h1>
        {doc.description ? (
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600 dark:text-stone-400">
            {doc.description}
          </p>
        ) : null}
      </div>

      <article className="docs-prose">
        <MDXRemote
          source={doc.content}
          components={components}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
              rehypePlugins: [
                rehypeSlug,
                [rehypeAutolinkHeadings, { behavior: "wrap" }],
              ],
            },
          }}
        />
      </article>

      <div className="mt-12 grid gap-3 border-t border-stone-200 pt-6 sm:grid-cols-2 dark:border-stone-800">
        {prev ? (
          <Link
            href={prev.href}
            className="rounded-ui border border-stone-200 px-4 py-3 text-sm transition hover:border-brandPrimary/40 dark:border-stone-800"
          >
            <div className="text-xs text-stone-500">Previous</div>
            <div className="font-medium text-stone-900 dark:text-stone-50">{prev.title}</div>
          </Link>
        ) : (
          <div />
        )}
        {next ? (
          <Link
            href={next.href}
            className="rounded-ui border border-stone-200 px-4 py-3 text-right text-sm transition hover:border-brandPrimary/40 dark:border-stone-800"
          >
            <div className="text-xs text-stone-500">Next</div>
            <div className="font-medium text-stone-900 dark:text-stone-50">{next.title}</div>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
