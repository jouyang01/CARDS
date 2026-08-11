import { defineConfig } from 'vite';

// GH_PAGES_BASE is set by the deploy workflow to "/<repo-name>/" so the built
// site works on GitHub Pages project URLs. Locally it defaults to "/".
export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? '/',
  build: { target: 'es2022' },
});
