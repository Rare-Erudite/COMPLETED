/**
 * Navigation acceptance tests (section 24).
 *
 * These exercise the real NavigationStack against a simulated browser history,
 * so the Back behaviour is proven rather than asserted. The Android host calls
 * the same `RareHandleBack` contract these tests drive.
 */

import { NavigationStack } from '../src/navigation/navigationStack.js';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A minimal browser-history stand-in that records push/replace/back. */
class FakeHistory {
  entries: string[] = ['root'];
  index = 0;
  pushState(_s: unknown, _t: string, _u: string): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push('entry');
    this.index = this.entries.length - 1;
  }
  replaceState(): void {
    /* no-op: the entry count does not change */
  }
  back(): void {
    if (this.index > 0) this.index -= 1;
  }
}

function installFakeWindow(): { history: FakeHistory; firePop: () => void } {
  const history = new FakeHistory();
  const listeners: Array<() => void> = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    history,
    location: { href: 'https://rare.local/' },
    scrollY: 0,
    scrollTo: () => undefined,
    addEventListener: (name: string, fn: () => void) => {
      if (name === 'popstate') listeners.push(fn);
    },
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    localStorage: undefined,
    requestAnimationFrame: (fn: () => void) => fn(),
    setTimeout: (fn: () => void) => fn(),
  };
  g.requestAnimationFrame = (fn: () => void) => fn();
  return {
    history,
    firePop: () => {
      for (const fn of listeners) fn();
    },
  };
}

export async function runNavigationTests(): Promise<void> {
  console.log('\n=== Navigation (section 24) ===');

  const { history, firePop } = installFakeWindow();

  // 1. Home -> Documents -> Document viewer -> Back -> Documents -> Back -> Home
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('documents');
    nav.navigate('documents', { docId: 'abc' });
    check('viewer is two levels deep', nav.depth === 2, `depth=${nav.depth}`);

    nav.back();
    history.back();
    firePop();
    check('Back from viewer lands on Documents', nav.current.tab === 'documents' && nav.depth === 1);

    nav.back();
    history.back();
    firePop();
    check('Back from Documents lands on Home', nav.depth === 0);
    check('Back at root reports no in-app screen', nav.canGoBack() === false);
    nav.dispose();
  }

  // 2. Research -> result -> Back -> Research
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('research');
    nav.navigate('research', { resultId: 'r1' });
    nav.back();
    history.back();
    firePop();
    check('Back from a research result returns to Research', nav.current.tab === 'research' && nav.depth === 1);
    nav.dispose();
  }

  // 3. Plugins -> configuration -> Back -> Plugins
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('plugins');
    nav.navigate('plugins', { pluginId: 'github' });
    nav.back();
    history.back();
    firePop();
    check('Back from plugin configuration returns to Plugins', nav.current.tab === 'plugins' && nav.depth === 1);
    nav.dispose();
  }

  // 4. Settings -> nested -> Back -> Settings
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('settings');
    nav.navigate('settings', { section: 'security' });
    nav.back();
    history.back();
    firePop();
    check('Back from a settings subsection returns to Settings', nav.current.tab === 'settings' && nav.depth === 1);
    nav.dispose();
  }

  // 5. Chat -> conversation -> Back -> conversation list
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('chat', { convId: 'c1' });
    check('opening a conversation pushes an entry', nav.depth === 1);
    nav.back();
    history.back();
    firePop();
    check('Back from a conversation returns to the list', nav.depth === 0 && nav.current.tab === 'chat');
    nav.dispose();
  }

  // 6. Project Builder -> project details -> Back
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('projects');
    nav.navigate('projects', { projectId: 'p1' });
    nav.back();
    history.back();
    firePop();
    check('Back from project details returns to Project Builder', nav.current.tab === 'projects' && nav.depth === 1);
    nav.dispose();
  }

  // 7. Multi-department history is preserved in order
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('documents');
    nav.navigate('research');
    nav.navigate('plugins');
    const tabs = nav.history().map((e) => e.tab);
    check(
      'history records departments in order',
      tabs.join('>') === 'chat>documents>research>plugins',
      tabs.join('>'),
    );
    nav.dispose();
  }

  // 8. Duplicate screens are not stacked
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('documents');
    nav.navigate('documents');
    nav.navigate('documents');
    check('re-navigating to the same screen does not duplicate it', nav.depth === 1, `depth=${nav.depth}`);
    nav.dispose();
  }

  // 9. A modal is an entry, so Back dismisses it before the screen underneath
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('documents');
    nav.navigate('documents', { docId: 'abc' });
    nav.navigate('documents', { docId: 'abc', modal: 'share' });
    check('modal sits above the viewer', nav.depth === 3, `depth=${nav.depth}`);
    nav.back();
    history.back();
    firePop();
    check(
      'Back dismisses the modal and keeps the viewer',
      nav.depth === 2 && nav.current.params.docId === 'abc' && nav.current.params.modal === undefined,
      `depth=${nav.depth} params=${JSON.stringify(nav.current.params)}`,
    );
    nav.dispose();
  }

  // 10. Root Back never closes the app by itself
  {
    const nav = new NavigationStack(null);
    nav.install();
    const popped = nav.back();
    check('back() at the root returns false (caller decides, app does not close)', popped === false);
    check('root is still on screen after a root Back', nav.current.tab === 'chat');
    nav.dispose();
  }

  // 11. resetTo collapses nested screens
  {
    const nav = new NavigationStack(null);
    nav.install();
    nav.navigate('documents');
    nav.navigate('documents', { docId: 'a' });
    nav.navigate('documents', { docId: 'b' });
    nav.resetTo('documents');
    check('resetTo collapses to a single department root', nav.depth === 0 && nav.current.tab === 'documents');
    nav.dispose();
  }

  // 12. State restoration from storage
  {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;

    const first = new NavigationStack(storage);
    first.install();
    first.navigate('research');
    first.navigate('research', { resultId: 'r9' });
    (first as unknown as { persist: () => void }).persist();
    first.dispose();

    const second = new NavigationStack(storage);
    second.install();
    check(
      'navigation history is restored after a restart',
      second.depth === 2 && second.current.tab === 'research' && second.current.params.resultId === 'r9',
      `depth=${second.depth} tab=${second.current.tab}`,
    );
    second.dispose();
  }

  console.log(`\nNavigation: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} navigation test(s) failed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runNavigationTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
