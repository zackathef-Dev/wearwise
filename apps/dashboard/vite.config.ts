import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { pageHeaders } from './scripts/deploy-headers.mjs';

/* A production build must ship security headers that let it reach its own backend: the CSP's
   connect-src names exactly one Supabase host (scripts/deploy-headers.mjs). A build for an HTTPS
   backend the headers don't name stops here with the fix, instead of deploying a site that can't
   sign anyone in. A build against a local http backend is for this machine only (vite preview
   doesn't send those headers), so it just warns. */
function checkDeployHeaders(mode: string) {
  const backend = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL;
  if (!backend) return;
  const url = new URL(backend);
  if (url.protocol !== 'https:') {
    console.warn(`\n[wearwise] Building against ${url.origin}: fine for local preview, not for deployment (deploy headers only allow HTTPS).\n`);
    return;
  }
  const csp = pageHeaders(backend)['Content-Security-Policy']!;
  const connect = csp.split('; ').find((d) => d.startsWith('connect-src'))!;
  for (const file of ['public/_headers', 'vercel.json']) {
    if (!readFileSync(file, 'utf8').includes(connect)) {
      throw new Error(`${file} doesn't allow ${url.host}. Run \`npm run deploy-config -w dashboard\` (rewrites public/_headers and vercel.json for VITE_SUPABASE_URL), commit both, then build again.`);
    }
  }
}

/* Ports: 5190/5191 belonged to the design mockup during development, so the viewer dashboard takes the
   next pair. strictPort makes a collision fail loudly instead of drifting.
   Base is '/': the app uses real URL paths (react-router), so a static host must
   serve index.html for unknown paths (see README). */
export default defineConfig(({ command, mode }) => {
  if (command === 'build') checkDeployHeaders(mode);
  return {
    plugins: [react()],
    server: { port: 5192, strictPort: true },
    preview: { port: 5193, strictPort: true },
    /* One chunk is ~150 KB gzipped (react-dom + supabase-js make up most of it);
       splitting it would not make a dashboard behind a sign-in any faster. */
    /* No source maps in the deployed site: there is no error-reporting service to use
       them, and the bundle stays small. */
    build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 700 },
  };
});
