/**
 * Utility functions for making resilient HTTP requests.
 */

export interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Enhanced fetch with timeout and exponential backoff retry logic.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 15000,
    maxRetries = 3,
    baseDelayMs = 1000,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal as any,
      });

      clearTimeout(id);

      // Retry on 429 Too Many Requests or 5xx Server Errors
      if (!response.ok && (response.status === 429 || response.status >= 500)) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // If the error was an abort (timeout), we still want to retry unless we run out of attempts
      attempt++;
      if (attempt >= maxRetries) {
        break;
      }

      // Exponential backoff
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`fetchWithRetry failed after ${maxRetries} attempts: ${lastError?.message}`);
}
