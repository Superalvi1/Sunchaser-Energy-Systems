import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@openmaic/renderer/fonts.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import '@fontsource-variable/inter';

import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { StorageHealthNotice } from '@/components/storage-health-notice';
import { AccessCodeGuard } from '@/components/access-code-guard';
import { ProSwapWatcher } from '@/components/workbench/ProSwapWatcher';
import { verifyLearningSession, type LearningIdentity } from '@/lib/server/learning-session';

export const metadata: Metadata = {
  title: 'OpenMAIC',
  description:
    'The open-source AI interactive classroom. Upload a PDF to instantly generate an immersive, multi-agent learning experience.',
};

async function currentIdentity(): Promise<LearningIdentity | null> {
  const token = (await cookies()).get('sunchaser_learning')?.value;
  if (!token) return null;
  try {
    return await verifyLearningSession(token);
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const identity = await currentIdentity();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`} suppressHydrationWarning>
        <ThemeProvider>
          <I18nProvider>
            <ServerProvidersInit />
            <ProSwapWatcher />
            {identity ? (
              <div className="fixed right-4 top-4 z-[180] flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/90 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/90">
                <span className="max-w-40 truncate font-semibold text-slate-700 dark:text-slate-200">{identity.name || identity.email}</span>
                <form action="/api/auth/logout" method="post">
                  <button type="submit" className="rounded-full bg-[#103056] px-3 py-1.5 font-bold text-white transition hover:bg-[#184878]">Sign out</button>
                </form>
              </div>
            ) : null}
            <AccessCodeGuard>{children}</AccessCodeGuard>
            <Toaster position="top-center" />
            <StorageHealthNotice />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
