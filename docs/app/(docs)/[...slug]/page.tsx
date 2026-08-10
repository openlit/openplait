import type { Metadata } from "next";
import { DocArticle } from "@/components/DocArticle";
import { getAllDocSlugs, getDocBySlug, hrefForSlug } from "@/lib/docs";

type Params = { slug?: string[] };

export function generateStaticParams() {
  return getAllDocSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const slug = params.slug || [];
  if (!slug.length) return {};
  const doc = getDocBySlug(slug);
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: hrefForSlug(slug) },
  };
}

export default function DocPage({ params }: { params: Params }) {
  const slug = params.slug || [];
  const doc = getDocBySlug(slug);
  return <DocArticle doc={doc} />;
}
