import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig, loadEnv} from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // GitHub Pages needs a stable subpath so bundled assets resolve correctly.
  // We prefer the repo name from CI, but fall back to the known Pages repo name.
  const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'Tulsi';
  const isGitHubPagesBuild = process.env.DEPLOY_TARGET === 'github-pages';

  return {
    // Use the repo subpath only for Pages builds; local/preview keeps root paths.
    base: isGitHubPagesBuild ? `/${repoName}/` : '/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(projectRoot, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Proxy Firebase Auth helper when using authDomain=localhost (fixes Google OAuth on local dev)
      ...(env.VITE_FIREBASE_AUTH_DOMAIN === 'localhost' && env.VITE_FIREBASE_PROJECT_ID
        ? {
            proxy: {
              '/__/auth': {
                target: `https://${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
                changeOrigin: true,
                secure: true,
              },
              '/__/firebase': {
                target: `https://${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
                changeOrigin: true,
                secure: true,
              },
            },
          }
        : {}),
    },
    preview: {
      host: '0.0.0.0',
      port: parseInt(process.env.PORT || '8080'),
      strictPort: true,
      allowedHosts: true,
    },
  };
});
