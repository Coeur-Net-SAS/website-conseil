import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  // A remplacer par le domaine definitif quand il sera connu.
  // Le sitemap sera reactive une fois ce domaine en place :
  //   import sitemap from '@astrojs/sitemap';
  //   integrer sitemap() dans la liste integrations.
  site: 'https://conseil.coeur-net.fr',
  integrations: [
    tailwind({
      // On utilisera notre propre fichier de styles globaux
      applyBaseStyles: false,
    }),
  ],
  // Astro generera des fichiers HTML statiques par defaut
  output: 'static',
});
