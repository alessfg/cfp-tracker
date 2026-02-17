// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://alessfg.github.io',
  base: '/cfp-tracker',
  vite: {
    plugins: [tailwindcss()]
  }
});