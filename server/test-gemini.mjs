import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("GEMINI_API_KEY is missing. Run this from the server folder and check server/.env locally.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60000 } });

console.log("Testing model access with a 60-second request timeout (API key will not be printed).");
try {
  const models = await ai.models.list();
  const visible = [];
  for await (const model of models) {
    if (model.name?.toLowerCase().includes("gemini")) visible.push(model.name);
  }
  console.log("Gemini models listed for this key:");
  console.log(visible.length ? visible.join("\n") : "(No Gemini models returned by list endpoint)");
} catch (error) {
  console.log("Model listing failed:", error?.status ?? error?.name, String(error?.message ?? "").slice(0, 240));
}

const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

console.log("\nTesting short generation requests:");
for (const model of candidates) {
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model,
      contents: "Reply with only the word OK.",
      config: { maxOutputTokens: 8, temperature: 0 },
    });
    console.log(`${model}: OK (${Date.now() - started} ms): ${(response.text ?? "").trim()}`);
  } catch (error) {
    console.log(`${model}: FAIL (${Date.now() - started} ms), status=${error?.status ?? error?.statusCode ?? error?.name}`);
    console.log(String(error?.message ?? "Unknown error").slice(0, 240).replace(/\s+/g, " "));
  }
}
