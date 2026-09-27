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
    'min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16 overflow-x-hidden',
    'min-h-[100dvh] w-full bg-[radial-gradient(circle_at_20%_10%,rgba(245,180,32,0.15),transparent_32%),radial-gradient(circle_at_85%_15%,rgba(16,48,86,0.16),transparent_34%),linear-gradient(to_bottom,#f8fbff,#eef4fb)] dark:bg-[radial-gradient(circle_at_20%_10%,rgba(245,180,32,0.12),transparent_30%),linear-gradient(to_bottom,#071525,#0b1f36)] flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16 overflow-x-hidden',
  ],
  [
    `className={cn('relative z-20 w-full max-w-[800px] flex flex-col items-center mt-[10vh]')}`,
    `className={cn('relative z-20 w-full max-w-[920px] flex flex-col items-center mt-[5vh]')}`,
  ],
  ['className="h-12 md:h-16 mb-2 -ml-2 md:-ml-3"', 'className="h-16 md:h-24 mb-3 drop-shadow-sm"'],
  [
    `{t('home.slogan')}`,
    `Build courses, train teams, and learn faster with your Sunchaser AI instructor.`,
  ],
  [
    'className="text-sm text-muted-foreground/60 mb-8"',
    'className="max-w-2xl text-center text-sm md:text-base font-medium text-slate-600 dark:text-slate-300 mb-5"',
  ],
  [
    `        {/* ── Unified input area ── */}`,
    `        <motion.div
          initial={heroEnter({ opacity: 0, y: 8 })}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-5 flex flex-wrap justify-center gap-2"
        >
          {[
            ['Solar Sales Training', 'Create a practical solar sales training course for Pakistan with objection handling, system sizing basics, financing conversations, and a final quiz.'],
            ['Technical Skills', 'Teach me solar PV system design step by step, including load assessment, inverter sizing, battery sizing, protection, and installation checks.'],
            ['Business Growth', 'Create an interactive course on SEO, social media lead generation, WhatsApp follow-up, and sales conversion for a growing business.'],
          ].map(([label, prompt]) => (
            <button
              key={label}
              type="button"
              onClick={() => updateForm('requirement', prompt)}
              className="rounded-full border border-[#e3aa22]/35 bg-white/80 px-3.5 py-2 text-xs font-semibold text-[#103056] shadow-sm transition hover:-translate-y-0.5 hover:border-[#e3aa22] hover:bg-[#fff8e6] hover:shadow-md dark:bg-slate-900/80 dark:text-amber-100"
            >
              {label}
            </button>
          ))}
        </motion.div>

        {/* ── Unified input area ── */}`,
  ],
  [
    'className="w-full rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-black/[0.03] dark:shadow-black/20 transition-shadow focus-within:shadow-2xl focus-within:shadow-violet-500/[0.06]"',
    'className="w-full rounded-[28px] border border-[#103056]/10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl shadow-[0_24px_70px_rgba(16,48,86,0.14)] transition-all focus-within:border-[#e3aa22]/60 focus-within:shadow-[0_28px_80px_rgba(16,48,86,0.2)]"',
  ],
  [
    `placeholder={t('upload.requirementPlaceholder')}`,
    `placeholder="What would you like to learn or teach? Describe the audience, topic, and desired course length…"`,
  ],
  [
    `        {/* Settings Button */}\n        <div className="relative">\n          <button\n            onClick={() => setSettingsOpen(true)}\n            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"\n          >\n            <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />\n          </button>\n        </div>`,
    `        {/* Provider configuration is managed centrally on Railway. */}`,
  ],
]);

replace('components/generation/generation-toolbar.tsx', [
  [
    'className="h-8 w-auto max-w-[260px] gap-1.5 rounded-full px-2.5 text-xs"',
    'className="hidden"',
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
