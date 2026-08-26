/**
 * Mobile design tokens for the staff/admin app shell.
 *
 * These exist so mobile presentation is a deliberate system rather than ad-hoc
 * shrinking scattered across components. Every value is fluid or relative — no
 * device-model dimensions — and each is verified at 360/375/390/393/414/430px.
 *
 * Desktop is untouched: consumers apply these only under `useIsMobile()` or behind
 * a `md:` reset, so nothing here reaches >=768px.
 */
export const mobileUi = {
  /** Fixed top app bar: one toolbar row + status-bar inset. */
  topBar:
    "safe-area-top fixed top-0 inset-x-0 z-50 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800",
  topBarInner: "flex h-14 items-center gap-2 px-3",
  topBarTitle: "min-w-0 flex-1 truncate text-base font-bold text-slate-100",
  topBarBtn:
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-300 active:scale-95 transition",

  /** Fixed bottom navigation: one row + home-indicator inset. */
  bottomNav:
    "fixed bottom-0 inset-x-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 pb-[env(safe-area-inset-bottom,0px)]",
  bottomNavInner: "mx-auto flex h-16 max-w-lg items-stretch justify-around px-1",
  bottomNavBtn:
    "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition active:scale-95",
  bottomNavActive: "text-amber-400",
  bottomNavIdle: "text-slate-500",
  bottomNavLabel: "max-w-full truncate text-[10px] font-semibold leading-none",

  /**
   * Scroll padding for the fixed chrome. Top bar is 3.5rem + inset; bottom nav is
   * 4rem + inset. Applied to the scrolling <main> so content is never trapped
   * under either bar.
   */
  shellMain:
    "pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[calc(4rem+env(safe-area-inset-bottom,0px))]",

  /** Consistent horizontal gutter — one value everywhere on mobile. */
  gutter: "px-3",
  /** Vertical rhythm between page sections. */
  section: "space-y-3",

  /** Page heading inside a screen (below the top bar). */
  pageTitle: "text-lg font-bold tracking-tight text-slate-100",
  pageSubtitle: "text-xs text-slate-400",

  /** Cards: full width, never wider than the viewport, modest radius/padding. */
  card: "w-full min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-3",
  cardTight: "w-full min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-2.5",

  /** Buttons — all >=44px tall for comfortable touch targets. */
  btnPrimary:
    "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 active:scale-[0.99] transition",
  btnSecondary:
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm font-semibold text-slate-200 active:scale-[0.99] transition",
  /** Compact action used in dense grids (quick actions). */
  btnCompact:
    "inline-flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-2 text-xs font-semibold text-slate-200 active:scale-95 transition",

  /** A row in a list/accordion — full width, >=48px. */
  listRow:
    "flex min-h-[48px] w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left",

  /**
   * Horizontal chip carousel. This is the ONLY sanctioned horizontal scroll on
   * mobile: contained to its own box and prevented from chaining to the document.
   */
  chipScroller:
    "-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  chip:
    "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition",
  chipOn: "border-amber-500/50 bg-amber-500/15 text-amber-300",
  chipOff: "border-slate-800 bg-slate-950 text-slate-400",

  /** Standard mobile icon size. */
  icon: "h-5 w-5",
  iconSm: "h-4 w-4",
} as const;
