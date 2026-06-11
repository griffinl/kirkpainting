#!/usr/bin/env node
/**
 * backdate-articles.mjs — Spread article dates backward so a bulk-published
 * batch looks naturally drip-published instead of all dated the same day.
 *
 * Assigns ~perDay articles to each day, walking back from today. Only the
 * publishedAt / updatedAt fields are rewritten (targeted string replace), so
 * the rest of each JSON file is untouched and git diffs stay clean.
 *
 * Usage:
 *   node scripts/backdate-articles.mjs            # default ~11/day
 *   node scripts/backdate-articles.mjs --per-day 10
 *   node scripts/backdate-articles.mjs --dry-run
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const perDay = Number(args[args.indexOf('--per-day') + 1]) || 11;
const dryRun = args.includes('--dry-run');

const dir = path.resolve(import.meta.dirname, '..', 'src', 'content', 'articles');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

if (files.length === 0) {
  console.log('No article JSON files found.');
  process.exit(0);
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

let changed = 0;
files.forEach((file, i) => {
  const daysBack = Math.floor(i / perDay);
  const date = dateNDaysAgo(daysBack);
  const full = path.join(dir, file);
  const text = readFileSync(full, 'utf-8');

  const next = text
    .replace(/("publishedAt":\s*")\d{4}-\d{2}-\d{2}(")/, `$1${date}$2`)
    .replace(/("updatedAt":\s*")\d{4}-\d{2}-\d{2}(")/, `$1${date}$2`);

  if (next !== text) {
    if (!dryRun) writeFileSync(full, next, 'utf-8');
    changed++;
  }
});

const span = Math.ceil(files.length / perDay);
console.log(
  `${dryRun ? '[dry-run] ' : ''}${changed}/${files.length} articles dated across the last ${span} day(s) (~${perDay}/day).`
);
