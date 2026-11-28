/**
 * RARE — Connector Framework: HTTP helper
 *
 * One place for the outbound calls every connector makes, so timeouts,
 * error shaping and JSON parsing are consistent. A connector must never hang
 * a request: every call is bounded by a timeout.
 */

export interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<FetchJsonResult<T>> {
  const { timeoutMs = 15000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return { ok: res.ok, status: res.status, data, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, data: null, text: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Build a query string from a record, skipping undefined/empty values. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** A short, safe error string from a failed fetch result. */
export function describeFailure(status: number, text: string): string {
  if (status === 0) return `Network error: ${text.slice(0, 200)}`;
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `HTTP ${status}${trimmed ? `: ${trimmed}` : ''}`;
}
