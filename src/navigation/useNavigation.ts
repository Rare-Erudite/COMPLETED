/**
 * React binding for the navigation stack.
 *
 * `useNavigation()` gives a component the current entry and the navigation
 * actions. `useAndroidBack()` installs the Back interception that the Android
 * host drives, so system Back and gesture Back take the same path as the
 * browser's Back button.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  navigationStack,
  installNavigationBridge,
  type NavSnapshot,
} from './navigationStack';

export function useNavigation(): NavSnapshot & {
  navigate: typeof navigationStack.navigate;
  back: () => boolean;
  resetTo: typeof navigationStack.resetTo;
  patchParams: typeof navigationStack.patchParams;
} {
  const snapshot = useSyncExternalStore(
    navigationStack.subscribe,
    navigationStack.getSnapshot,
    navigationStack.getSnapshot,
  );

  return {
    ...snapshot,
    navigate: useCallback((...args: Parameters<typeof navigationStack.navigate>) => {
      navigationStack.navigate(...args);
    }, []),
    back: useCallback(() => navigationStack.back(), []),
    resetTo: useCallback((...args: Parameters<typeof navigationStack.resetTo>) => {
      navigationStack.resetTo(...args);
    }, []),
    patchParams: useCallback((...args: Parameters<typeof navigationStack.patchParams>) => {
      navigationStack.patchParams(...args);
    }, []),
  };
}

/**
 * Install the browser-history bridge and the Android Back interceptor.
 *
 * Called once from the app root. `onRootBack` is invoked when Back is pressed
 * at the root; the app uses it to show its "press again to exit" affordance
 * instead of silently closing.
 */
export function useAndroidBack(onRootBack?: () => void): void {
  useEffect(() => {
    installNavigationBridge();
    navigationStack.install();
    return () => navigationStack.dispose();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // The Android host calls this global when the system Back button or the
    // gesture is used. Returning `true` means "I consumed it", which tells the
    // host not to finish the activity.
    const handler = (): boolean => {
      if (navigationStack.canGoBack()) {
        navigationStack.back();
        return true;
      }
      if (onRootBack) {
        onRootBack();
        return true;
      }
      return false;
    };

    (window as unknown as Record<string, unknown>).RareHandleBack = handler;

    // A hardware Back inside the WebView arrives as a keydown on some builds.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.defaultPrevented) return;
      if (event.key !== 'Back' && event.key !== 'BrowserBack') return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      delete (window as unknown as Record<string, unknown>).RareHandleBack;
    };
  }, [onRootBack]);
}
