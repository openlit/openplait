import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "content");

export type DocMeta = {
  title: string;
  description?: string;
  slug: string[];
};

export type DocPage = DocMeta & {
  content: string;
};

function walk(dir: string, base: string[] = []): string[][] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const slugs: string[][] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      slugs.push(...walk(path.join(dir, entry.name), [...base, entry.name]));
      continue;
    }
    if (!entry.name.endsWith(".mdx")) continue;
    const name = entry.name.replace(/\.mdx$/, "");
    slugs.push(name === "index" ? base : [...base, name]);
  }
  return slugs;
}

export function getAllDocSlugs(): string[][] {
  return walk(CONTENT_DIR);
}

function fileForSlug(slug: string[]): string {
  if (slug.length === 0) {
    throw new Error("Empty slug");
  }
  const nested = path.join(CONTENT_DIR, ...slug) + ".mdx";
  if (fs.existsSync(nested)) return nested;
  const indexFile = path.join(CONTENT_DIR, ...slug, "index.mdx");
  if (fs.existsSync(indexFile)) return indexFile;
  throw new Error(`Missing doc for /${slug.join("/")}`);
}

export function getDocBySlug(slug: string[]): DocPage {
  const filePath = fileForSlug(slug);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  const title =
    typeof data.title === "string"
      ? data.title
      : slug[slug.length - 1]?.replace(/-/g, " ") || "OpenPlait";
  return {
    title,
    description: typeof data.description === "string" ? data.description : undefined,
    slug,
    content,
  };
}

export function hrefForSlug(slug: string[]): string {
  return `/${slug.join("/")}/`;
}
