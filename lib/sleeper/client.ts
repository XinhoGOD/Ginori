const DEFAULT_TIMEOUT_MS = 12_000;

export class SleeperError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'SleeperError';
  }
}

export async function sleeperFetch<T>(url: string, init?: RequestInit, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) throw new SleeperError(`Sleeper HTTP ${response.status}`, response.status);
        throw new SleeperError(`Sleeper HTTP ${response.status}`, response.status);
      }
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new SleeperError('Sleeper request failed');
}
