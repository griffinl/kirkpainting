import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/articles' }),
});

export const collections = { articles };
