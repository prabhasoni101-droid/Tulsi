import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig, loadEnv} from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // To deploy to GitHub pages, the base must match the repository name.
  // We can dynamically get it from github actions, or you can manually hardcode it.
  // REPLACE 'Vrinda-app' with your actual repository name if it differs and you build locally
  const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
  // When GitHub repo metadata is available, use the repo subpath for Pages.
  // Local dev and Railway builds still fall back to '/' because the variable is absent.

  return {
    // Use repo subpath on GitHub-hosted builds; always use root on Railway & local dev.
    base: repoName ? `/${repoName}/` : '/',
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
