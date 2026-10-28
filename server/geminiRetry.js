// geminiRetry.js
// Retry + fallback policy for Gemini calls. No SDK import, no network, no secrets,
// so it can be unit-tested with simulated errors (see geminiRetry.test.mjs).

export function errorStatus(error) {
  const direct = Number(error?.status ?? error?.statusCode ?? error?.code);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = /"code"\s*:\s*(\d{3})/.exec(String(error?.message || ""));
  return match ? Number(match[1]) : 0;
}

// kinds: auth | bad_request | not_found | rate_limited | timeout | transient | empty | other
export function classify(error) {
  if (error?.emptyResponse) return "empty";
  const status = errorStatus(error);
  if (status) {
    if (status === 401 || status === 403) return "auth";
    if (status === 400) return "bad_request";
    if (status === 404) return "not_found";
    if (status === 429) return "rate_limited";
    if (status === 504) return "timeout";
    if (status === 500 || status === 502 || status === 503) return "transient";
    return "other";
  }
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || /timeout|timed out|deadline|aborted/i.test(String(error?.message || ""))) {
    return "timeout";
  }
  const netText = `${error?.message || ""} ${error?.cause?.code || ""}`;
  if (/fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(netText)) return "transient";
  return "other";
}

// Retry-After header if the SDK exposes headers, otherwise Google's RetryInfo "retryDelay": "46s" in the error body.
export function retryAfterMs(error) {
  const headers = error?.headers;
  const raw = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
  if (raw != null && raw !== "") {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(String(error?.message || ""));
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

export class GeminiFailure extends Error {
  constructor(attempts, firstError, lastError) {
    super("All Gemini attempts failed");
    this.name = "GeminiFailure";
    this.attempts = attempts;       // [{ model, attempt, kind, status, ms, retryAfterMs? }]
    this.firstError = firstError;   // original error is kept, never swallowed
    this.lastError = lastError;
    this.summary = summarize(attempts);
  }
}

// Turns the attempt list into one safe code/message for the frontend.
export function summarize(attempts) {
  const kinds = new Set(attempts.map((a) => a.kind));
  const only = (...allowed) => [...kinds].every((k) => allowed.includes(k));
  const hinted = attempts.map((a) => a.retryAfterMs).filter((v) => Number.isFinite(v));
  const retryAfterSeconds = hinted.length ? Math.ceil(Math.max(...hinted) / 1000) : undefined;

  if (!attempts.length) {
    return { httpStatus: 503, code: "ai_busy", retryable: true, message: "The AI service did not get a chance to answer. Please try again." };
  }
  if (kinds.has("auth")) {
    return { httpStatus: 502, code: "auth", retryable: false, message: "Gemini rejected the API key or its permissions. Check the key in Google AI Studio and restart the backend." };
  }
  if (only("not_found")) {
    return { httpStatus: 502, code: "model_unavailable", retryable: false, message: "None of the configured Gemini models is available to this API key. Run the diagnostic script and update GEMINI_MODEL." };
  }
  if (only("not_found", "rate_limited")) {
    return { httpStatus: 429, code: "rate_limited", retryable: true, retryAfterSeconds, message: "Gemini rate limit or quota reached. Wait a little and try again." };
  }
  if (only("not_found", "timeout")) {
    return { httpStatus: 504, code: "ai_timeout", retryable: true, message: "The AI model took too long to answer. Try a shorter question or try again in a minute." };
  }
  if (kinds.has("bad_request") && only("bad_request", "not_found")) {
    return { httpStatus: 502, code: "ai_error", retryable: false, message: "Gemini rejected the request. Check the backend terminal for details." };
  }
  if (kinds.has("transient") || kinds.has("timeout") || kinds.has("rate_limited")) {
    return { httpStatus: 503, code: "ai_busy", retryable: true, retryAfterSeconds, message: "The AI service is busy right now. Please try again in a minute." };
  }
  return { httpStatus: 502, code: "ai_error", retryable: false, message: "Gemini could not complete the request. Check the backend terminal for details." };
}

/**
 * Try each model in order. Per model:
 *  - 503/500/502/network: retry with exponential backoff + jitter, honouring Retry-After / retryDelay
 *  - 429: retry only if the server-provided wait is short enough, otherwise move to the next model
 *  - 504/timeout: do NOT retry the same model (it already used its full time slot), move on
 *  - 404 / empty answer: move to the next model
 *  - 401/403/400: stop, other models will not fix a key or request problem
 * Everything is bounded by budgetMs so the browser never waits longer than that.
 */
export async function runWithFallback({
  models,
  call, // async (model, { timeoutMs, attempt }) => ({ text })  — must throw on failure
  onLog = () => {},
  budgetMs = 75000,
  perAttemptMs = 45000,
  minAttemptMs = 8000,
  maxAttemptsPerModel = 3,
  baseDelayMs = 1000,
  maxDelayMs = 8000,
  maxRetryAfterMs = 15000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  const started = now();
  const attempts = [];
  let firstError;
  let lastError;

  outer: for (const model of models) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      const remaining = budgetMs - (now() - started);
      if (remaining < minAttemptMs) {
        onLog({ event: "budget_exhausted", remainingMs: remaining });
        break outer;
      }
      const timeoutMs = Math.min(perAttemptMs, remaining);
      const t0 = now();
      try {
        const value = await call(model, { timeoutMs, attempt });
        onLog({ event: "success", model, attempt, ms: now() - t0, totalMs: now() - started });
        return { ...value, model, attempts: [...attempts, { model, attempt, kind: "ok", status: 200, ms: now() - t0 }] };
      } catch (error) {
        const kind = classify(error);
        const status = errorStatus(error) || null;
        const hinted = retryAfterMs(error);
        const record = { model, attempt, kind, status, ms: now() - t0 };
        if (hinted != null) record.retryAfterMs = hinted;
        attempts.push(record);
        firstError ??= error;
        lastError = error;
        onLog({ event: "attempt_failed", ...record });

        if (kind === "auth" || kind === "bad_request") break outer;
        if (kind !== "transient" && kind !== "rate_limited") continue outer; // not_found, timeout, empty, other
        if (attempt >= maxAttemptsPerModel) continue outer;

        let delay;
        if (hinted != null) {
          if (hinted > maxRetryAfterMs) continue outer; // too long to wait here, try next model
          delay = hinted + Math.round(random() * 250);
        } else {
          const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
          delay = Math.round(cap / 2 + (random() * cap) / 2); // "equal jitter"
        }
        if (budgetMs - (now() - started) - delay < minAttemptMs) continue outer;
        onLog({ event: "retrying", model, kind, delayMs: delay });
        await sleep(delay);
      }
    }
  }
  throw new GeminiFailure(attempts, firstError, lastError);
}
