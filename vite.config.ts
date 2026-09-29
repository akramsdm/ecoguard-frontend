/// <reference types="vitest/config" />
import {defineConfig,loadEnv} from 'vite';
import type {Plugin} from 'vite';
import react from '@vitejs/plugin-react';

const proxyTarget=process.env.API_PROXY_TARGET||'http://localhost:8000';

// Production builds must ship with a real MapTiler key — the OSM fallback is a
// development convenience and must never reach production. Dev server + preview
// are unaffected; the runtime getTileProfile() error is just a second line of
// defence for anyone who bypasses the build.
function guardTileConfig(): Plugin {
  return {
    name: 'ecoguard-tile-config-guard',
    configResolved(config) {
      if (config.command !== 'build') return;
      const env = {...loadEnv(config.mode, config.root, ''), ...pickViteEnv(process.env)};
      const provider = (env.VITE_MAP_TILE_PROVIDER || 'maptiler').trim().toLowerCase();
      const key = (env.VITE_MAPTILER_KEY || '').trim();
      if (provider === 'osm') {
        throw new Error(
          'Tile config guard: VITE_MAP_TILE_PROVIDER=osm is development-only. ' +
          'Production builds require MapTiler tiles — put your VITE_MAPTILER_KEY in .env and rebuild.'
        );
      }
      if (provider !== 'maptiler') {
        throw new Error(`Tile config guard: unsupported VITE_MAP_TILE_PROVIDER "${provider}".`);
      }
      if (!key || key.length < 8 || /\s/.test(key)) {
        throw new Error(
          'Tile config guard: VITE_MAPTILER_KEY is missing or invalid in this build environment. ' +
          'Set it in .env (a MapTiler API key, URL-safe, no spaces) — production must never ship the OSM fallback.'
        );
      }
    },
  };
}

function pickViteEnv(obj: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(obj)) {
    if (k.startsWith('VITE_') && typeof obj[k] === 'string') out[k] = obj[k] as string;
  }
  return out;
}

export default defineConfig({
  plugins: [react(), guardTileConfig()],
  test: {setupFiles: ['./src/lib/test-setup.ts']},
  server: {host: '0.0.0.0', port: 5173, proxy: {'/api': {target: proxyTarget, changeOrigin: true}}},
  preview: {host: '0.0.0.0', port: 5173, proxy: {'/api': {target: proxyTarget, changeOrigin: true}}},
});