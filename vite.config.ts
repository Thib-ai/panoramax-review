import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.env.VITE_BASE_PATH || '/';

function injectBaseHtml(): Plugin {
  const b = base.endsWith('/') ? base : base + '/';
  return {
    name: 'inject-base-hrefs',
    transformIndexHtml(html) {
      return html
        .replace(/href="\/manifest\.json"/g, `href="${b}manifest.json"`)
        .replace(/href="\/favicon\.svg"/g, `href="${b}favicon.svg"`)
        .replace(/href="\/icon-[^"]+"/g, (m) => m.replace('href="/', `href="${b}`));
    },
  };
}

function rewriteManifest(): Plugin {
  const b = base.endsWith('/') ? base : base + '/';
  return {
    name: 'rewrite-manifest-paths',
    generateBundle() {
      const src = readFileSync('public/manifest.json', 'utf8');
      const rewritten = src
        .replace(/"src":\s*"\/icon-/g, `"src": "${b}icon-`)
        .replace(/"start_url":\s*"\/"/, `"start_url": "${b}"`);
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: rewritten });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), injectBaseHtml(), rewriteManifest()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
