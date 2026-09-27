import { normalizeNextPath } from '@/lib/server/learning-session';

const errors: Record<string, string> = {
  name: 'Please enter your full name.',
  email: 'Please enter a valid email address.',
  password: 'Use a password with at least 8 characters.',
  confirm: 'The two passwords do not match.',
  exists: 'An account with this email already exists. Sign in instead.',
  credentials: 'Email or password is incorrect.',
  unavailable: 'The account service is temporarily unavailable. Please try again.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LearningAuthPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = params.mode === 'register' ? 'register' : 'login';
  const errorCode = typeof params.error === 'string' ? params.error : '';
  const next = normalizeNextPath(typeof params.next === 'string' ? params.next : '/');
  const isRegister = mode === 'register';

  return (
    <main className="min-h-[100dvh] bg-[#071525] px-5 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(245,180,32,0.2),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(35,98,154,0.35),transparent_35%),linear-gradient(160deg,#071525_0%,#0b2039_58%,#071525_100%)]" />
      <div className="relative mx-auto flex min-h-[calc(100dvh-4rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.07] shadow-2xl backdrop-blur-xl lg:grid-cols-[0.9fr_1.1fr]">
          <section className="hidden border-r border-white/10 p-12 lg:flex lg:flex-col lg:justify-between">
            <a href="/" aria-label="Back to Learning Studio">
              <img src="/sunchaser-learning-studio.svg" alt="Sunchaser AI Learning Studio" className="h-20 w-auto" />
            </a>
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-amber-300">Independent learning account</p>
              <h1 className="mt-4 text-4xl font-black leading-tight">Learn, create courses, and keep your progress in one place.</h1>
              <p className="mt-5 leading-7 text-slate-300">Your Learning Studio account is separate from the Sunchaser CRM. Registration and sign-in stay on this website.</p>
            </div>
            <p className="text-xs text-slate-500">Securely hosted on Sunchaser Railway infrastructure.</p>
          </section>

          <section className="bg-[#071525]/35 p-6 sm:p-10 lg:p-14">
            <a href="/" className="mb-8 inline-flex text-sm font-bold text-slate-300 transition hover:text-amber-300">← Back to Learning Studio</a>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-amber-300">Sunchaser Learning Studio</p>
            <h2 className="mt-3 text-3xl font-black sm:text-4xl">{isRegister ? 'Create your account' : 'Welcome back'}</h2>
            <p className="mt-3 text-slate-300">{isRegister ? 'Register free and start learning immediately.' : 'Sign in to continue your courses and learning progress.'}</p>

            {errorCode && errors[errorCode] ? (
              <div role="alert" className="mt-6 rounded-2xl border border-red-300/25 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-100">
                {errors[errorCode]}
              </div>
            ) : null}

            <form action={isRegister ? '/api/auth/register' : '/api/auth/login'} method="post" className="mt-7 space-y-5">
              <input type="hidden" name="next" value={next} />
              {isRegister ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-200">Full name</span>
                  <input name="displayName" required minLength={2} maxLength={80} autoComplete="name" className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3.5 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/15" placeholder="Your full name" />
                </label>
              ) : null}
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-200">Email address</span>
                <input type="email" name="email" required maxLength={254} autoComplete="email" className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3.5 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/15" placeholder="you@example.com" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-200">Password</span>
                <input type="password" name="password" required minLength={8} maxLength={128} autoComplete={isRegister ? 'new-password' : 'current-password'} className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3.5 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/15" placeholder="At least 8 characters" />
              </label>
              {isRegister ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-200">Confirm password</span>
                  <input type="password" name="confirmPassword" required minLength={8} maxLength={128} autoComplete="new-password" className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3.5 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/15" placeholder="Repeat your password" />
                </label>
              ) : null}
              <button type="submit" className="w-full rounded-2xl bg-amber-400 px-6 py-4 text-base font-black text-[#071525] shadow-[0_16px_40px_rgba(245,180,32,0.22)] transition hover:-translate-y-0.5 hover:bg-amber-300">
                {isRegister ? 'Create account and start learning' : 'Sign in to Learning Studio'}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-slate-300">
              {isRegister ? 'Already have a Learning Studio account?' : 'New to Learning Studio?'}{' '}
              <a href={`/auth?mode=${isRegister ? 'login' : 'register'}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`} className="font-extrabold text-amber-300 hover:text-amber-200">
                {isRegister ? 'Sign in' : 'Create a free account'}
              </a>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
