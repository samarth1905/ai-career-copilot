// Tests ONE model with a long timeout. The API key is read from server/.env and is never printed.
// Usage (from the server folder):
//   node diag-model.mjs gemini-3.8-flash          (90 s timeout)
//   node diag-model.mjs gemini-3.5-flash-lite 60  (custom timeout in seconds, 60-90 recommended)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

const envPath = fileURLToPath(new URL("./.env", import.meta.url));
if (!existsSync(envPath)) console.error(`.env file NOT FOUND at: ${envPath} (check it is not named .env.txt)`);
dotenv.config({ path: envPath });

const [model, secondsArg = "90"] = process.argv.slice(2);
if (!model) {
  console.error("Usage: node diag-model.mjs <model-id> [timeoutSeconds]");
  process.exit(1);
}
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("GEMINI_API_KEY not found. Run this from the server folder and check server/.env locally.");
  process.exit(1);
}

const timeoutMs = Math.max(60, Number(secondsArg) || 90) * 1000;
const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });

console.log(`Testing ${model} with a ${timeoutMs / 1000}s timeout...`);
const started = Date.now();
try {
  const response = await ai.models.generateContent({
    model,
    contents: "Give me two short sentences of career advice for a beginner software developer.",
    config: { temperature: 0.3 },
  });
  const text = (response.text ?? "").trim();
  console.log(`RESULT: OK  model=${model}  time=${Date.now() - started}ms  chars=${text.length}`);
  console.log(`finishReason=${response.candidates?.[0]?.finishReason ?? "n/a"}  thoughtsTokens=${response.usageMetadata?.thoughtsTokenCount ?? "n/a"}  outputTokens=${response.usageMetadata?.candidatesTokenCount ?? "n/a"}`);
  console.log(text ? `Answer: ${text.slice(0, 200)}` : "(empty text: check finishReason above)");
} catch (error) {
  const status = error?.status ?? error?.statusCode ?? error?.name;
  console.log(`RESULT: FAIL  model=${model}  status=${status}  time=${Date.now() - started}ms`);
  console.log("Google message:", String(error?.message ?? "").replace(/\s+/g, " ").slice(0, 300));
  if (status === 404) console.log("Meaning: the model ID was not found or is not available to this key.");
  else if (status === 503) console.log("Meaning: Google says the model is overloaded right now. Not an invalid ID and not a key problem.");
  else if (status === 504 || error?.name === "AbortError" || /timeout|deadline/i.test(String(error?.message))) {
    console.log("Meaning: the model did not finish within the timeout. This is NOT proof that the model ID is invalid.");
  } else if (status === 429) console.log("Meaning: quota or rate limit for this model (each model has its own quota).");
  else if (status === 400 || status === 401 || status === 403) console.log("Meaning: key, permission or request problem.");
}
