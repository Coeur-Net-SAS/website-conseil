import { defineCollection, z } from 'astro:content';

// Collection "blog" : chaque fichier .md de src/content/blog/ devra
// respecter ce schéma. Astro validera automatiquement au build.
const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Cabinet conseil'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // Image de couverture optionnelle (chemin relatif à /public ou URL)
    cover: z.string().optional(),
  }),
});

export const collections = { blog };
