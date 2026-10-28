import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";
import { runWithFallback, GeminiFailure, errorStatus } from "./geminiRetry.js";

// Load server/.env from this file's own folder, no matter which folder the server was started from.
const envPath = fileURLToPath(new URL("./.env", import.meta.url));
const envFileFound = existsSync(envPath);
dotenv.config({ path: envPath });

const app = express();
const port = Number(process.env.PORT) || 3001;
const rawKey = process.env.GEMINI_API_KEY?.trim();
const apiKey = rawKey && rawKey !== "replace_with_your_key" ? rawKey : undefined;
const primaryModel = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
const fallbackModels = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite")
  .split(",").map((model) => model.trim()).filter(Boolean);
const modelChain = [...new Set([primaryModel, ...fallbackModels])];

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
// One attempt may use up to perAttemptMs; the whole request (all models, retries, waits) never exceeds budgetMs.
// Keep the frontend timeout (src/App.jsx REQUEST_TIMEOUT_MS) a little above budgetMs.
const perAttemptMs = numberFromEnv("GEMINI_TIMEOUT_MS", 45000);
const budgetMs = numberFromEnv("GEMINI_BUDGET_MS", 75000);

const ai = apiKey
  ? new GoogleGenAI({ apiKey, httpOptions: { timeout: perAttemptMs } })
  : null;

app.disable("x-powered-by");
app.use(express.json({ limit: "30kb" }));
app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "too_many_requests", message: "Too many requests. Wait a minute and try again.", retryable: true } },
}));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(ai),
    model: primaryModel,
    fallbackModels,
    perAttemptMs,
    budgetMs,
  });
});

function requireAI(_req, res, next) {
  if (!ai) {
    return res.status(503).json({
      error: { code: "not_configured", message: "Gemini API key is missing. Add GEMINI_API_KEY to server/.env and restart the backend." },
    });
  }
  next();
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function makeHistory(history) {
  if (!Array.isArray(history)) return [];
  const turns = history.slice(-10).flatMap((item) => {
    if (!item || !["user", "assistant"].includes(item.role)) return [];
    const text = cleanText(item.text, 3000);
    if (!text) return [];
    return [{ role: item.role === "assistant" ? "model" : "user", parts: [{ text }] }];
  });
  // The conversation sent to Gemini should start with a user turn (the UI's greeting is an assistant turn).
  while (turns.length && turns[0].role === "model") turns.shift();
  return turns;
}

// Safe to log: status/name/short provider message. Never includes the API key or the user's text.
function describeError(error) {
  return {
    name: error?.name,
    status: errorStatus(error) || undefined,
    message: String(error?.message || "").slice(0, 240),
  };
}

function logEvent(label, { event, ...details }) {
  const line = `[${label}] ${event}`;
  if (event === "attempt_failed" || event === "budget_exhausted") console.error(line, details);
  else console.log(line, details);
}

async function generateWithFallback({ contents, config, label }) {
  return runWithFallback({
    models: modelChain,
    budgetMs,
    perAttemptMs,
    onLog: (entry) => logEvent(label, entry),
    call: async (model, { timeoutMs, attempt }) => {
      console.log(`[${label}] Trying ${model} (attempt ${attempt}, timeout ${Math.round(timeoutMs / 1000)}s)`);
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { ...config, httpOptions: { timeout: timeoutMs } },
      });
      const text = response.text?.trim();
      if (!text) {
        console.error(`[${label}] ${model} returned no text`, { finishReason: response.candidates?.[0]?.finishReason });
        throw Object.assign(new Error("Gemini returned an empty response"), { emptyResponse: true });
      }
      return { text };
    },
  });
}

function sendRouteError(res, error, label) {
  let summary;
  let attempts;
  if (error instanceof GeminiFailure) {
    summary = error.summary;
    attempts = error.attempts.map(({ model, kind, status }) => ({ model, kind, status }));
    // Original error is kept in the log; the browser only gets the safe summary.
    console.error(`[${label}] giving up: ${summary.code}`, { attempts: error.attempts, firstError: describeError(error.firstError) });
  } else {
    summary = { httpStatus: 500, code: "server_error", retryable: false, message: "Unexpected server error. Check the backend terminal for details." };
    console.error(`[${label}] unexpected error:`, describeError(error));
  }
  if (res.headersSent) return;
  if (summary.retryAfterSeconds) res.set("Retry-After", String(summary.retryAfterSeconds));
  res.status(summary.httpStatus).json({
    error: {
      code: summary.code,
      message: summary.message,
      retryable: summary.retryable,
      ...(summary.retryAfterSeconds ? { retryAfterSeconds: summary.retryAfterSeconds } : {}),
      ...(attempts ? { attempts } : {}),
    },
  });
}

app.post("/api/chat", requireAI, async (req, res) => {
  const started = Date.now();
  console.log("[/api/chat] Request received");
  const message = cleanText(req.body?.message, 4000);
  if (!message) return res.status(400).json({ error: { code: "empty_message", message: "Enter a question first." } });

  try {
    const history = makeHistory(req.body?.history);
    const contents = [...history, { role: "user", parts: [{ text: message }] }];
    const config = {
      systemInstruction: "You are Career Copilot, a supportive and realistic career mentor for students and early-career developers. Help with learning plans, software engineering, cloud engineering, AI, projects, resumes, and interview preparation. Be clear, practical, encouraging, and honest. Break complex topics into steps. Do not guarantee jobs or salaries. Ask a short clarifying question when needed. If discussing changing facts such as hiring trends, certifications, or salaries, remind the user to verify with current official sources. Never ask the user to share passwords, API keys, or other secrets.",
      temperature: 0.7,
      maxOutputTokens: 1200,
    };
    const result = await generateWithFallback({ contents, config, label: "/api/chat" });
    console.log(`[/api/chat] Responding in ${Date.now() - started}ms using ${result.model}`);
    res.json({ reply: result.text, model: result.model });
  } catch (error) {
    console.error(`[/api/chat] Failed after ${Date.now() - started}ms`);
    sendRouteError(res, error, "/api/chat");
  }
});

app.post("/api/roadmap", requireAI, async (req, res) => {
  const started = Date.now();
  console.log("[/api/roadmap] Request received");
  const targetRole = cleanText(req.body?.targetRole, 100);
  const level = cleanText(req.body?.level, 30);
  const months = Number(req.body?.months);

  if (!targetRole) return res.status(400).json({ error: { code: "missing_role", message: "Enter a target role." } });
  if (!["Beginner", "Intermediate", "Advanced"].includes(level)) {
    return res.status(400).json({ error: { code: "invalid_level", message: "Choose a valid current level." } });
  }
  if (![1, 3, 6, 8, 12].includes(months)) {
    return res.status(400).json({ error: { code: "invalid_months", message: "Choose a timeframe from the available options." } });
  }

  try {
    const prompt = `Create a practical ${months}-month learning roadmap for a student targeting the role "${targetRole}". Current level: ${level}. Use plain text with clear headings. Include: (1) an honest outcome expectation, (2) monthly milestones, (3) weekly study routine that can fit around college, (4) hands-on projects that grow in difficulty, (5) skills and tools to practise, (6) portfolio/GitHub milestones, (7) interview preparation, and (8) measurable checkpoints. Prioritize fundamentals and projects; avoid overwhelming the learner. Do not guarantee employment or a salary. If a certification is mentioned, make it optional and advise verifying current exam details.`;
    const result = await generateWithFallback({
      contents: prompt,
      config: { temperature: 0.65, maxOutputTokens: 1800 },
      label: "/api/roadmap",
    });
    console.log(`[/api/roadmap] Responding in ${Date.now() - started}ms using ${result.model}`);
    res.json({ roadmap: result.text, model: result.model });
  } catch (error) {
    console.error(`[/api/roadmap] Failed after ${Date.now() - started}ms`);
    sendRouteError(res, error, "/api/roadmap");
  }
});

// Anything under /api that did not match a route: JSON, never an HTML error page.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Unknown API route." } });
});

// Last-resort error handler (bad JSON body, body too large, unexpected exceptions): always JSON.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "invalid_json", message: "The request body was not valid JSON." } });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "payload_too_large", message: "That message is too long. Please shorten it." } });
  }
  console.error("[server] unhandled error:", describeError(err));
  res.status(500).json({ error: { code: "server_error", message: "Unexpected server error. Check the backend terminal for details." } });
});

app.listen(port, () => {
  console.log(`Career Copilot API listening at http://localhost:${port}`);
  console.log(`Gemini key configured: ${Boolean(apiKey)} | Primary model: ${primaryModel}`);
  console.log(`Fallback models: ${fallbackModels.join(", ") || "(none)"}`);
  console.log(`Timeouts: ${perAttemptMs}ms per attempt, ${budgetMs}ms per request`);
  console.log(envFileFound ? `.env file found: ${envPath}` : `.env file NOT FOUND at: ${envPath} (check it is not named .env.txt)`);
  if (!apiKey) {
    console.warn(rawKey
      ? "GEMINI_API_KEY is still the placeholder value. Put your real key in server/.env and restart."
      : "GEMINI_API_KEY is empty or missing. Add a line GEMINI_API_KEY=your_key to server/.env and restart.");
  }
});
