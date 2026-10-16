import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {execSync} from 'child_process';

function getGitCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (e) {
    return 'unknown';
  }
}

function getFormattedBuildTime() {
  const date = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const syncShell = (process.env.VITE_APP_VARIANT || env.VITE_APP_VARIANT) === 'sync';
  return {
    plugins: [react(), tailwindcss(), {
      name: 'sync-shell-metadata',
      transformIndexHtml(html: string) {
        if (!syncShell) return html;
        return html
          .replace(/<title>[^<]*<\/title>/, '<title>Sunchaser Sync | Solar CRM</title>')
          .replace('href="/manifest.json"', 'href="/manifest-sync.webmanifest"')
          .replace('rel="icon" href="/assets/sunchaser-logo.png" type="image/png"', 'rel="icon" href="/sync-icon.svg" type="image/svg+xml"')
          .replace('content="#1a2b4c"', 'content="#020617"')
          .replace('</head>', '<meta name="description" content="Company workspaces, solar quotations, invoices, payment balances and customer documents with Sunchaser Sync." /><meta property="og:title" content="Sunchaser Sync | Solar CRM" /><meta property="og:description" content="From solar enquiry to a clear payment balance." /></head>');
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    define: {
      __GIT_COMMIT_HASH__: JSON.stringify(getGitCommitHash()),
      __BUILD_TIME__: JSON.stringify(getFormattedBuildTime()),
      __BUILD_ENV__: JSON.stringify(process.env.NODE_ENV || 'production'),
    }
  };
});
