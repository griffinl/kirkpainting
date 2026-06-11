import type { Article } from './types';

const articleFiles = import.meta.glob<Article>('../content/articles/*.json', {
  eager: true,
  import: 'default',
});

export function getAllArticles(): Article[] {
  return Object.values(articleFiles).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function getArticlesByCategory(category: string): Article[] {
  return getAllArticles().filter((a) => a.category === category);
}

export function getArticle(category: string, slug: string): Article | undefined {
  return getAllArticles().find((a) => a.category === category && a.slug === slug);
}

export function getAllCategories(): string[] {
  return [...new Set(getAllArticles().map((a) => a.category))];
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** True when an article is an informational guide rather than a product roundup. */
export function isGuide(a: Article): boolean {
  return a.type === 'guide';
}

/** Rough reading time in minutes (~200 wpm) from a guide's body + intro. */
export function readingTime(a: Article): number {
  const html = `${a.body ?? ''} ${a.intro ?? ''}`;
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * Kirk Score — a 0–100 confidence score derived from a product's star rating and
 * review volume. Rating drives the bulk (88 pts); review count adds a small
 * log-scale "evidence" bonus (up to 12 pts) so a 4.6★ with 9,000 reviews edges out
 * a 4.6★ with 40. Deterministic from existing fields, so AmazonScrapling needs no
 * schema change — it's the data-driven hook of the Kirk Painting brand.
 */
export function kirkScore(p: { rating: number; reviewCount: number }): number {
  const ratingPart = (Math.max(0, Math.min(5, p.rating)) / 5) * 88;
  const evidence = Math.min(12, Math.log10((p.reviewCount ?? 0) + 1) * 3.2);
  return Math.round(ratingPart + evidence);
}

/**
 * Display headline with an accurate count prefix derived from the real number of
 * products, e.g. "Best Magazine Racks of 2026" → "13 Best Magazine Racks of 2026".
 * AI titles are stored number-free; the count always matches what's actually listed.
 * Leaves already-numbered titles untouched.
 */
export function articleHeadline(article: Article): string {
  const title = article.title.trim();
  const n = article.products.length;
  if (n < 2 || /^\d/.test(title)) return title;
  return `${n} ${title}`;
}

// Words that carry no topical signal for relatedness scoring.
const STOP_WORDS = new Set([
  'best', 'the', 'of', 'for', 'and', 'to', 'a', 'an', 'your', 'with', 'in',
  'on', 'top', 'review', 'reviews', 'guide', 'buying',
  '2024', '2025', '2026', '2027',
]);

function titleTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Build-time "related posts" (like YARPP, but no DB/runtime cost). Scores every
 * other article: same category is the strongest signal, then shared title
 * keywords, with recency as the tie-breaker. Always returns up to `limit`
 * articles for solid internal linking, falling back to recent ones if nothing
 * is strongly related.
 */
export function getRelatedArticles(article: Article, limit = 3): Article[] {
  const baseTokens = new Set(titleTokens(article.title));
  return getAllArticles()
    .filter((a) => a.slug !== article.slug)
    .map((a) => {
      let score = a.category === article.category ? 10 : 0;
      for (const w of titleTokens(a.title)) if (baseTokens.has(w)) score += 2;
      return { a, score, updated: new Date(a.updatedAt).getTime() };
    })
    .sort((x, y) => y.score - x.score || y.updated - x.updated)
    .slice(0, limit)
    .map((s) => s.a);
}
