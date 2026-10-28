// Run with:  node --test geminiRetry.test.mjs
// Uses a fake clock and simulated errors. It does NOT call Gemini and needs no API key.
import test from "node:test";
import assert from "node:assert/strict";
import { runWithFallback, classify, errorStatus, retryAfterMs, GeminiFailure } from "./geminiRetry.js";

function apiError(status, body = "") {
  const e = new Error(JSON.stringify({ error: { code: status, message: body || `err ${status}` } }));
  e.name = "ApiError";
  e.status = status;
  return e;
}

// Fake world: clock advances by each call's simulated duration and by each sleep.
function world(script) {
  let t = 0;
  const log = { calls: [], sleeps: [] };
  const queues = Object.fromEntries(Object.entries(script).map(([m, steps]) => [m, [...steps]]));
  return {
    log,
    opts: {
      now: () => t,
      sleep: async (ms) => { log.sleeps.push(ms); t += ms; },
      random: () => 0.5,
      call: async (model, { timeoutMs }) => {
        const step = (queues[model] ?? []).shift() ?? { fail: apiError(503) };
        log.calls.push({ model, timeoutMs, at: t });
        t += step.ms ?? 300;
        if (step.fail) throw step.fail;
        return { text: step.text ?? "hello" };
      },
    },
    elapsed: () => t,
  };
}

test("503 twice then success on the same model", async () => {
  const w = world({ A: [{ fail: apiError(503) }, { fail: apiError(503) }, { text: "ok" }], B: [] });
  const r = await runWithFallback({ models: ["A", "B"], ...w.opts });
  assert.equal(r.model, "A");
  assert.equal(r.text, "ok");
  assert.equal(w.log.calls.length, 3);
  assert.equal(w.log.sleeps.length, 2);
  // equal jitter with random=0.5: attempt1 cap 1000 -> 750, attempt2 cap 2000 -> 1500
  assert.deepEqual(w.log.sleeps, [750, 1500]);
});

test("all models 503: bounded, returns ai_busy summary, keeps original error", async () => {
  const w = world({ A: [], B: [] }); // default step is 503
  await assert.rejects(runWithFallback({ models: ["A", "B"], ...w.opts }), (err) => {
    assert.ok(err instanceof GeminiFailure);
    assert.equal(err.summary.code, "ai_busy");
    assert.equal(err.summary.httpStatus, 503);
    assert.equal(err.attempts.length, 6); // 3 per model
    assert.equal(errorStatus(err.firstError), 503);
    return true;
  });
  assert.ok(w.elapsed() < 75000, `took ${w.elapsed()}ms`);
});

test("504 on primary is not retried; fallback gets the remaining time", async () => {
  const w = world({ A: [{ fail: apiError(504), ms: 45000 }], B: [{ text: "from B" }] });
  const r = await runWithFallback({ models: ["A", "B"], ...w.opts });
  assert.equal(r.model, "B");
  assert.equal(w.log.calls.filter((c) => c.model === "A").length, 1);
  assert.equal(w.log.calls[1].timeoutMs, 30000); // 75s budget - 45s used
  assert.equal(w.log.sleeps.length, 0);
});

test("429 with short retryDelay waits then retries the same model", async () => {
  const e429 = apiError(429, "quota");
  e429.message = JSON.stringify({ error: { code: 429, details: [{ retryDelay: "3s" }] } });
  const w = world({ A: [{ fail: e429 }, { text: "ok" }] });
  const r = await runWithFallback({ models: ["A", "B"], ...w.opts });
  assert.equal(r.model, "A");
  assert.equal(w.log.sleeps.length, 1);
  assert.ok(w.log.sleeps[0] >= 3000 && w.log.sleeps[0] <= 3250, `slept ${w.log.sleeps[0]}`);
});

test("429 with long retryDelay skips to next model without waiting", async () => {
  const e429 = apiError(429);
  e429.message = JSON.stringify({ error: { code: 429, details: [{ retryDelay: "46s" }] } });
  const w = world({ A: [{ fail: e429 }], B: [{ text: "from B" }] });
  const r = await runWithFallback({ models: ["A", "B"], ...w.opts });
  assert.equal(r.model, "B");
  assert.equal(w.log.sleeps.length, 0);
});

test("429 everywhere gives rate_limited with retryAfterSeconds", async () => {
  const e429 = apiError(429);
  e429.message = JSON.stringify({ error: { code: 429, details: [{ retryDelay: "46s" }] } });
  const w = world({ A: [{ fail: e429 }], B: [{ fail: e429 }] });
  await assert.rejects(runWithFallback({ models: ["A", "B"], ...w.opts }), (err) => {
    assert.equal(err.summary.code, "rate_limited");
    assert.equal(err.summary.httpStatus, 429);
    assert.equal(err.summary.retryAfterSeconds, 46);
    return true;
  });
});

test("404 on primary falls back; 404 everywhere is model_unavailable", async () => {
  const w1 = world({ A: [{ fail: apiError(404) }], B: [{ text: "ok" }] });
  const r = await runWithFallback({ models: ["A", "B"], ...w1.opts });
  assert.equal(r.model, "B");

  const w2 = world({ A: [{ fail: apiError(404) }], B: [{ fail: apiError(404) }] });
  await assert.rejects(runWithFallback({ models: ["A", "B"], ...w2.opts }), (err) => {
    assert.equal(err.summary.code, "model_unavailable");
    return true;
  });
});

test("401/403 stops immediately and reports auth", async () => {
  const w = world({ A: [{ fail: apiError(403) }], B: [{ text: "should not run" }] });
  await assert.rejects(runWithFallback({ models: ["A", "B"], ...w.opts }), (err) => {
    assert.equal(err.summary.code, "auth");
    assert.equal(err.attempts.length, 1);
    return true;
  });
  assert.equal(w.log.calls.length, 1);
});

test("timeouts everywhere stay inside the budget and report ai_timeout", async () => {
  const slow = { fail: apiError(504), ms: 45000 };
  const w = world({ A: [slow], B: [{ fail: apiError(504), ms: 30000 }], C: [slow] });
  await assert.rejects(runWithFallback({ models: ["A", "B", "C"], ...w.opts }), (err) => {
    assert.equal(err.summary.code, "ai_timeout");
    assert.equal(err.summary.httpStatus, 504);
    return true;
  });
  assert.ok(w.elapsed() <= 75000, `took ${w.elapsed()}ms`);
  assert.equal(w.log.calls.some((c) => c.model === "C"), false); // no budget left
});

test("empty answer moves to the next model", async () => {
  const empty = Object.assign(new Error("empty"), { emptyResponse: true });
  const w = world({ A: [{ fail: empty }], B: [{ text: "ok" }] });
  const r = await runWithFallback({ models: ["A", "B"], ...w.opts });
  assert.equal(r.model, "B");
});

test("classify / errorStatus / retryAfterMs helpers", () => {
  assert.equal(errorStatus(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}')), 503);
  assert.equal(classify(Object.assign(new Error("x"), { name: "AbortError" })), "timeout");
  assert.equal(classify(new Error("fetch failed")), "transient");
  assert.equal(classify(apiError(503, "Spikes in demand are usually temporary")), "transient");
  assert.equal(classify(apiError(500)), "transient");
  assert.equal(classify(new Error("something odd")), "other");
  const withHeader = Object.assign(new Error("x"), { status: 503, headers: new Headers({ "retry-after": "7" }) });
  assert.equal(retryAfterMs(withHeader), 7000);
  assert.equal(retryAfterMs(new Error("nothing")), null);
});
