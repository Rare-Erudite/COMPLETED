/**
 * RARE — Application navigation stack
 *
 * Why this exists
 * ---------------
 * The app used to switch screens with a bare `useState('chat')`. Nothing was
 * ever pushed onto `window.history`, so inside the Android WebView
 * `WebView.canGoBack()` was permanently false and every Back press fell
 * through to `Activity.onBackPressed()`, which finishes the activity. That is
 * the reported defect: Back closes RARE instead of returning to the previous
 * screen.
 *
 * This module makes the in-app navigation stack the single source of truth and
 * mirrors it onto `window.history`, so:
 *   - Android system Back / gesture Back pop the previous screen,
 *   - the browser Back button behaves identically,
 *   - deep links restore a screen,
 *   - history survives backgrounding because it is persisted.
 *
 * Everything that should be dismissible (a document viewer, a research result,
 * a plugin configuration page, a settings subsection, a conversation, a modal)
 * is an *entry*. Because dismissal is just popping an entry there is exactly
 * one code path for Back, which is what prevents the "modal closed but the
 * screen underneath also navigated" class of bug.
 */

export interface NavEntry {
  /** Stable id for this entry, used for de-duplication and scroll restore. */
  id: string;
  /** Department / top-level screen id, e.g. 'documents', 'settings'. */
  tab: string;
  /** Sub-screen parameters, e.g. { docId: 'abc' } or { modal: 'share' }. */
  params: Record<string, unknown>;
  /** Last known scroll offset for this entry. */
  scrollY: number;
}

export interface NavSnapshot {
  /** The entry currently on screen. */
  current: NavEntry;
  /** Number of entries below the current one (0 at the root). */
  depth: number;
  /** True when Back would pop an in-app screen. */
  canGoBack: boolean;
  /** The full stack, oldest first. Read-only view for debugging / the UI. */
  stack: readonly NavEntry[];
}

const STORAGE_KEY = 'rare.nav.v1';
const STATE_KEY = 'rareNav';

let entrySeq = 0;
function newId(): string {
  entrySeq += 1;
  return `n${Date.now().toString(36)}${entrySeq.toString(36)}`;
}

function makeEntry(tab: string, params: Record<string, unknown> = {}): NavEntry {
  return { id: newId(), tab, params, scrollY: 0 };
}

export class NavigationStack {
  private stack: NavEntry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: NavSnapshot;
  /** Guards against re-entrancy while we drive history ourselves. */
  private syncing = false;
  private installed = false;

  constructor(private readonly storage: Storage | null = typeof window !== 'undefined' ? safeStorage() : null) {
    this.stack = [makeEntry('chat')];
    this.snapshot = this.buildSnapshot();
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Attach to `window.history`. Safe to call more than once; the second call is
   * a no-op so React StrictMode double-mounting cannot stack listeners.
   */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;

    this.restore();

    // Seed the current entry so the very first Back has somewhere to land.
    window.history.replaceState(
      { [STATE_KEY]: { depth: this.stack.length - 1, id: this.current.id } },
      '',
      window.location.href,
    );

    window.addEventListener('popstate', this.onPopState);
    window.addEventListener('pagehide', this.persist);
    // Restore the scroll offset of the entry being left, before it unloads.
    window.addEventListener('beforeunload', this.persist);
  }

  dispose(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('popstate', this.onPopState);
    window.removeEventListener('pagehide', this.persist);
    window.removeEventListener('beforeunload', this.persist);
    this.installed = false;
  }

  // ------------------------------------------------------------------ reading

  getSnapshot = (): NavSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get current(): NavEntry {
    return this.stack[this.stack.length - 1];
  }

  get depth(): number {
    return this.stack.length - 1;
  }

  canGoBack(): boolean {
    return this.stack.length > 1;
  }

  history(): readonly NavEntry[] {
    return this.stack;
  }

  // ----------------------------------------------------------------- mutating

  /**
   * Navigate to a screen. Pushing the screen you are already on is a no-op, so
   * tapping the same sidebar item twice cannot create a duplicate entry.
   */
  navigate(tab: string, params: Record<string, unknown> = {}, options: { replace?: boolean } = {}): void {
    const top = this.current;
    if (!options.replace && top.tab === tab && sameParams(top.params, params)) {
      return;
    }

    this.rememberScroll();

    if (options.replace) {
      this.stack[this.stack.length - 1] = { ...makeEntry(tab, params), scrollY: 0 };
    } else {
      this.stack.push(makeEntry(tab, params));
    }

    this.pushHistory(!options.replace);
    this.emit();
    this.restoreScrollForCurrent();
  }

  /**
   * Pop the current in-app screen.
   *
   * Returns true when a screen was popped, false when the stack is already at
   * the root — the caller then applies the agreed root behaviour (ask before
   * exiting). It is deliberately the caller's decision: the navigation layer
   * never closes the application by itself.
   */
  back(): boolean {
    if (!this.canGoBack()) return false;
    this.rememberScroll();
    // `history.back()` drives the actual pop through the popstate handler so
    // that browser and Android share one path.
    if (typeof window !== 'undefined') {
      this.syncing = true;
      window.history.back();
    } else {
      this.popLocal();
    }
    return true;
  }

  /** Jump straight to the root of a department, collapsing any nested screens. */
  resetTo(tab: string, params: Record<string, unknown> = {}): void {
    this.rememberScroll();
    while (this.stack.length > 1) this.stack.pop();
    this.stack[0] = { ...makeEntry(tab, params), scrollY: 0 };
    if (typeof window !== 'undefined') {
      window.history.replaceState({ [STATE_KEY]: { depth: 0, id: this.current.id } }, '', window.location.href);
    }
    this.emit();
  }

  /** Update params of the current entry without growing the stack. */
  patchParams(patch: Record<string, unknown>): void {
    const top = this.current;
    this.stack[this.stack.length - 1] = { ...top, params: { ...top.params, ...patch } };
    this.emit();
  }

  // ------------------------------------------------------------------ history

  private onPopState = (): void => {
    // The browser has already moved; mirror that move in our own stack.
    if (this.stack.length > 1) {
      this.popLocal();
    } else {
      // Back was pressed at the root. Re-seed the entry we are standing on so
      // the address bar still describes a screen, and let the UI decide what to
      // do about exiting (Android does this through the JS bridge).
      this.pushHistory(false);
    }
    this.syncing = false;
  };

  private popLocal(): void {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    this.emit();
    this.restoreScrollForCurrent();
    this.dispatchRootBackIfNeeded();
  }

  /**
   * When a pop lands on the root, tell anyone listening (the Android back
   * handler) that the next Back is a root Back and must confirm before exit.
   */
  private dispatchRootBackIfNeeded(): void {
    if (this.canGoBack() || typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('rare:nav-root-reached'));
    } catch {
      /* CustomEvent is unavailable in very old WebViews; harmless to skip. */
    }
  }

  private pushHistory(push: boolean): void {
    if (typeof window === 'undefined') return;
    const state = { [STATE_KEY]: { depth: this.stack.length - 1, id: this.current.id } };
    if (push) {
      window.history.pushState(state, '', window.location.href);
    } else {
      window.history.replaceState(state, '', window.location.href);
    }
  }

  // ------------------------------------------------------------------- state

  private rememberScroll(): void {
    if (typeof window === 'undefined') return;
    this.current.scrollY = window.scrollY || 0;
  }

  private restoreScrollForCurrent(): void {
    if (typeof window === 'undefined') return;
    const y = this.current.scrollY || 0;
    // Wait a frame so the screen is mounted before we scroll it.
    requestAnimationFrame(() => {
      try {
        window.scrollTo(0, y);
      } catch {
        /* scrolling is best-effort */
      }
    });
  }

  private persist = (): void => {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, stack: this.stack, savedAt: Date.now() }),
      );
    } catch {
      /* quota or private mode — navigation still works, it just won't restore */
    }
  };

  private restore(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { v?: number; stack?: NavEntry[]; savedAt?: number };
      if (parsed.v !== 1 || !Array.isArray(parsed.stack) || parsed.stack.length === 0) return;
      // Only restore a fresh history; a day-old stack would be confusing.
      if (!parsed.savedAt || Date.now() - parsed.savedAt > 12 * 60 * 60 * 1000) return;
      const clean = parsed.stack.filter(
        (e) => e && typeof e.tab === 'string' && typeof e.id === 'string',
      );
      if (clean.length === 0) return;
      this.stack = clean.map((e) => ({
        id: e.id,
        tab: e.tab,
        params: e.params && typeof e.params === 'object' ? e.params : {},
        scrollY: typeof e.scrollY === 'number' ? e.scrollY : 0,
      }));
    } catch {
      /* corrupt record — start fresh rather than crash the app */
    }
  }

  // ----------------------------------------------------------------- helpers

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a broken subscriber must not break navigation */
      }
    }
  }

  private buildSnapshot(): NavSnapshot {
    const current = this.stack[this.stack.length - 1];
    return {
      current,
      depth: this.stack.length - 1,
      canGoBack: this.stack.length > 1,
      stack: [...this.stack],
    };
  }
}

function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__rare_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** The single shared stack for the application. */
export const navigationStack = new NavigationStack();

/**
 * Bridge exposed to the Android host so `Activity` Back handling can ask the
 * web layer whether an in-app screen is available to pop. Without this the
 * WebView has no way to know that a viewer or a modal is open.
 */
export interface RareNavigationBridge {
  canGoBack(): boolean;
  back(): boolean;
  depth(): number;
  currentTab(): string;
}

export function installNavigationBridge(): void {
  if (typeof window === 'undefined') return;
  const bridge: RareNavigationBridge = {
    canGoBack: () => navigationStack.canGoBack(),
    back: () => navigationStack.back(),
    depth: () => navigationStack.depth,
    currentTab: () => navigationStack.current.tab,
  };
  (window as unknown as Record<string, unknown>).RareNavigation = bridge;
}
