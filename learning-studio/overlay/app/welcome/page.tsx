const features = [
  ['AI Course Builder', 'Turn a topic, document, or training goal into a structured course with practical lessons.'],
  ['Voice Teaching', 'Listen to lessons and slide narration with browser-based voice playback at no extra cost.'],
  ['Interactive Learning', 'Use slides, quizzes, classroom playback, and guided learning instead of static documents.'],
];

export default function LearningWelcomePage() {
  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#071525] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(245,180,32,0.2),transparent_32%),radial-gradient(circle_at_88%_18%,rgba(35,98,154,0.32),transparent_35%),linear-gradient(160deg,#071525_0%,#0b2039_55%,#071525_100%)]" />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <img src="/sunchaser-learning-studio.svg" alt="Sunchaser AI Learning Studio" className="h-14 w-auto sm:h-16" />
          <a href="/auth?mode=login" className="rounded-full border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:-translate-y-0.5 hover:border-amber-300/60 hover:bg-white/15">Sign in</a>
        </header>

        <section className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:py-20">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center rounded-full border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.2em] text-amber-300">Learn · Teach · Grow</div>
            <h1 className="text-5xl font-black leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">Practical learning,<span className="block bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent">powered by AI.</span></h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">Create professional courses, learn from narrated slides, test your knowledge, and train teams from one interactive Sunchaser platform.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href="/auth?mode=register" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-amber-400 px-7 py-3.5 text-base font-black text-[#071525] shadow-[0_18px_45px_rgba(245,180,32,0.25)] transition hover:-translate-y-1 hover:bg-amber-300">Create free account</a>
              <a href="/auth?mode=login" className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-7 py-3.5 text-base font-bold text-white backdrop-blur transition hover:-translate-y-1 hover:border-amber-300/50 hover:bg-white/15">Continue learning</a>
            </div>
            <p className="mt-4 text-sm text-slate-400">Independent Learning Studio account. No CRM account is required.</p>
          </div>

          <div className="relative">
            <div className="absolute -inset-5 rounded-[2.5rem] bg-gradient-to-br from-amber-300/20 to-blue-500/10 blur-2xl" />
            <div className="relative rounded-[2rem] border border-white/12 bg-white/[0.075] p-5 shadow-2xl backdrop-blur-xl sm:p-7">
              <div className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Learning Studio</p><h2 className="mt-1 text-2xl font-black">Your AI instructor</h2></div><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400 text-xl text-[#071525] shadow-lg">▶</div></div>
              <div className="space-y-3">
                {features.map(([title, description], index) => (
                  <div key={title} className="group rounded-2xl border border-white/10 bg-[#071525]/55 p-4 transition hover:-translate-y-0.5 hover:border-amber-300/35 hover:bg-[#0d2846]"><div className="flex gap-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-300/12 text-sm font-black text-amber-300">0{index + 1}</div><div><h3 className="font-extrabold text-white">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-400">{description}</p></div></div></div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <footer className="border-t border-white/10 py-5 text-center text-xs text-slate-500 sm:text-left">© 2026 Sunchaser Energy Systems · Secure learning powered by Sunchaser</footer>
      </div>
    </main>
  );
}
