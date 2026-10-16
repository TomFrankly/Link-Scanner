import { defineConfig, loadEnv, type Plugin } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  // Optional branding from app/.env (see .env.example).
  const env = loadEnv(mode, appDir, 'VITE_');
  const brand = {
    name: env.VITE_BRAND_NAME?.trim() || '',
    logo: env.VITE_LOGO_URL?.trim() || '/logo.svg',
    // Where the Help dialog's "Read the code" link points. Forks can point it at their own repo.
    repo: env.VITE_REPO_URL?.trim() || 'https://github.com/TomFrankly/Link-Scanner',
  };
  const title = brand.name ? `Link Checker · ${brand.name}` : 'Link Checker';
  const brandHtml: Plugin = {
    name: 'brand-html',
    transformIndexHtml: (html) => html.replaceAll('%BRAND_TITLE%', title).replaceAll('%BRAND_LOGO%', brand.logo),
  };

  return {
    root: 'web',
    envDir: appDir,
    plugins: [tailwindcss(), svelte({ preprocess: vitePreprocess() }), brandHtml],
    define: { __BRAND__: JSON.stringify(brand) },
    resolve: {
      alias: {
        $lib: fileURLToPath(new URL('./web/src/lib', import.meta.url)),
        $shared: fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    build: { outDir: '../dist', emptyOutDir: true },
    // `npm run dev:web` serves the UI with hot reload and proxies the API to `wrangler dev`.
    server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  };
});
