import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || '/src');
const brandingDir = path.dirname(fileURLToPath(import.meta.url));

function replace(relativePath, replacements) {
  const filePath = path.join(root, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');

  for (const [before, after] of replacements) {
    if (!source.includes(before)) {
      throw new Error(`Branding anchor not found in ${relativePath}: ${before.slice(0, 80)}`);
    }
    source = source.replaceAll(before, after);
  }

  fs.writeFileSync(filePath, source);
}

replace('app/layout.tsx', [
  ["title: 'OpenMAIC'", "title: 'Sunchaser AI Learning Studio'"],
  [
    "'The open-source AI interactive classroom. Upload a PDF to instantly generate an immersive, multi-agent learning experience.'",
    "'Create practical, interactive training courses for the Sunchaser team and customers.'",
  ],
]);

replace('app/page.tsx', [
  ['src="/logo-horizontal.png"', 'src="/sunchaser-learning-studio.svg"'],
  ['alt="OpenMAIC"', 'alt="Sunchaser AI Learning Studio"'],
  ['OpenMAIC Open Source Project', 'Sunchaser AI Learning Studio'],
  [
    `        {/* Settings Button */}\n        <div className="relative">\n          <button\n            onClick={() => setSettingsOpen(true)}\n            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"\n          >\n            <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />\n          </button>\n        </div>`,
    `        {/* Provider configuration is managed centrally on Railway. */}`,
  ],
]);

replace('components/stage/scene-sidebar.tsx', [
  ['src="/logo-horizontal.png" alt="OpenMAIC"', 'src="/sunchaser-learning-studio.svg" alt="Sunchaser AI Learning Studio"'],
]);

replace('components/scene-renderers/pbl/v2/workspace.tsx', [
  ['src="/openmaic-mark.png"', 'src="/sunchaser-mark.svg"'],
  ['alt="OpenMAIC"', 'alt="Sunchaser AI Learning Studio"'],
]);

replace('components/access-code-modal.tsx', [
  ['                OpenMAIC', '                Sunchaser AI Learning Studio'],
]);

fs.copyFileSync(
  path.join(brandingDir, 'sunchaser-learning-studio.svg'),
  path.join(root, 'public', 'sunchaser-learning-studio.svg'),
);
fs.copyFileSync(
  path.join(brandingDir, 'sunchaser-mark.svg'),
  path.join(root, 'public', 'sunchaser-mark.svg'),
);
