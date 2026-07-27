import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

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

// Inject the hashed build asset filenames into sw.js so the service worker
// pre-caches the actual JS/CSS bundles at install time. Without this, mobile
// browsers (Firefox in particular) that evict SW caches between sessions
// land on a blank page when reloaded offline: the cached index.html loads
// but its <script src="/assets/index-HASH.js"> returns 503 from the SW and
// React never mounts.
function precacheBuildAssets(): Plugin {
  const b = base.endsWith('/') ? base : base + '/';
  return {
    name: 'precache-build-assets-in-sw',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const assetsDir = path.join(distDir, 'assets');
      if (!existsSync(assetsDir)) return;
      const assets: string[] = [];
      for (const file of readdirSync(assetsDir)) {
        if (file.endsWith('.js') || file.endsWith('.css')) {
          assets.push(`${b}assets/${file}`);
        }
      }
      const swPath = path.join(distDir, 'sw.js');
      if (!existsSync(swPath)) return;
      let sw = readFileSync(swPath, 'utf8');
      const assetsLiteral = JSON.stringify(assets, null, 2);
      sw = sw.replace(
        /const SHELL_ASSETS\s*=\s*\[[\s\S]*?\];/,
        `const SHELL_ASSETS = [\n  './',\n  './index.html',\n  '${b}manifest.json',\n  '${b}favicon.svg',\n  ...${assetsLiteral}\n];`
      );
      // Bump the shell cache version on every build so the install/activate
      // lifecycle runs and the new asset list is actually pre-cached.
      sw = sw.replace(/const SHELL_CACHE\s*=\s*'panoramax-cache-v\d+'/, `const SHELL_CACHE = 'panoramax-cache-v${Date.now()}'`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), injectBaseHtml(), rewriteManifest(), precacheBuildAssets()],
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
