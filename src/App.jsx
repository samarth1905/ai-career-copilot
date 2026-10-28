import { useEffect, useRef, useState } from "react";
import "./App.css";

const starterPrompts = [
  "Create a 6-month cloud engineering roadmap for a beginner.",
  "Quiz me on JavaScript and explain my mistakes.",
  "Help me prepare for a software developer internship interview.",
];

function MessageContent({ text }) {
  // Simple readable rendering for plain-text AI responses.
  return <div className="message-content">{text.split("\n").map((line, index) => (
    <span key={index}>{line || "\u00a0"}{index < text.split("\n").length - 1 && <br />}</span>
  ))}</div>;
}

// Slightly above the backend's total budget (GEMINI_BUDGET_MS, 75s by default) so the server's
// clear error message normally arrives first and the page can never spin forever.
const REQUEST_TIMEOUT_MS = 85000;

async function postJSON(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // The backend sends { error: { code, message } }; also accept a plain string.
      const apiError = data?.error;
      const message = typeof apiError === "string" ? apiError : apiError?.message;
      throw new Error(message || `The backend did not answer correctly (HTTP ${response.status}). Check that it is running on port 3001 and look at its terminal.`);
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("This is taking too long. Please try again in a minute.");
    if (err instanceof TypeError) throw new Error("Couldn't reach the backend. Check that it is running on port 3001.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState("coach");
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hey! I'm your AI Career Coach. Tell me your target role, current skills, or what you're stuck on. I'll help you make a practical next-step plan." },
  ]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("checking");
  const [targetRole, setTargetRole] = useState("Cloud Engineer");
  const [level, setLevel] = useState("Beginner");
  const [months, setMonths] = useState("6");
  const [roadmap, setRoadmap] = useState("");
  const [roadmapBusy, setRoadmapBusy] = useState(false);
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Backend unavailable")))
      .then(() => setStatus("online"))
      .catch(() => setStatus("offline"));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // After 15s of waiting, tell the user the AI service is slow instead of showing the same message forever.
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [busy]);

  async function sendMessage(value = question) {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setError("");
    setQuestion("");
    setMessages((current) => [...current, { role: "user", text: prompt }]);
    setBusy(true);
    try {
      // Error bubbles are not part of the conversation, so they are not sent back to Gemini.
      const history = messages.filter((m) => !m.isError).slice(-10).map(({ role, text }) => ({ role, text }));
      const data = await postJSON("/api/chat", { message: prompt, history });
      setMessages((current) => [...current, { role: "assistant", text: data.reply }]);
    } catch (err) {
      const message = err.message || "Something went wrong. Please try again.";
      setError(message);
      setMessages((current) => [...current, { role: "assistant", isError: true, text: `I couldn't get a response this time. ${message}` }]);
    } finally {
      setBusy(false);
      setSlow(false);
    }
  }

  async function generateRoadmap(event) {
    event.preventDefault();
    setError("");
    setRoadmap("");
    setRoadmapBusy(true);
    try {
      const data = await postJSON("/api/roadmap", { targetRole, level, months: Number(months) });
      setRoadmap(data.roadmap);
    } catch (err) {
      setError(err.message || "Could not generate a roadmap. Please try again.");
    } finally {
      setRoadmapBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">CC</div><div><strong>Career Copilot</strong><small>YOUR NEXT CHAPTER</small></div></div>
        <div className="profile-card"><div className="avatar">S</div><div><strong>Career workspace</strong><small>Build skills. Get hired.</small></div></div>
        <p className="nav-label">WORKSPACE</p>
        <button className={`nav-item ${activeTab === "coach" ? "active" : ""}`} onClick={() => setActiveTab("coach")}><span>✦</span> AI Career Coach</button>
        <button className={`nav-item ${activeTab === "roadmap" ? "active" : ""}`} onClick={() => setActiveTab("roadmap")}><span>↗</span> Roadmap Generator</button>
        <div className="sidebar-bottom"><div className={`status-dot ${status}`} /><div><strong>{status === "online" ? "Backend connected" : status === "checking" ? "Checking backend…" : "Backend offline"}</strong><small>{status === "online" ? "Gemini endpoint available" : "Start the Node server"}</small></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div><span className="eyebrow">AI-POWERED CAREER DEVELOPMENT</span><h1>{activeTab === "coach" ? "Your AI Career Coach" : "Personalized Roadmap"}</h1></div><div className="topbar-chip"><span className={`status-dot ${status}`} />{status === "online" ? "System online" : status === "checking" ? "Connecting…" : "Needs setup"}</div></header>

        {error && <div className="error-banner" role="alert"><strong>Heads up:</strong> {error}</div>}

        {activeTab === "coach" ? (
          <section className="coach-layout">
            <div className="welcome-panel"><div className="sparkle">✦</div><div><span className="eyebrow">YOUR PERSONAL CAREER PARTNER</span><h2>Big goals. Clear next steps.</h2><p>Ask questions, practise interviews, learn technical concepts, or get a realistic plan for your target role.</p></div></div>
            <div className="chat-panel">
              <div className="chat-heading"><div><h2>Career chat</h2><p>Powered by Google Gemini through your secure backend</p></div><span className="live-pill"><i /> AI COACH</span></div>
              <div className="messages" aria-live="polite">
                {messages.map((message, index) => <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}><div className="message-avatar">{message.role === "assistant" ? "✦" : "S"}</div><div className="message-bubble"><div className="message-author">{message.role === "assistant" ? "Career Copilot" : "You"}</div><MessageContent text={message.text} /></div></div>)}
                {busy && <div className="message-row assistant"><div className="message-avatar">✦</div><div className="message-bubble"><div className="message-author">Career Copilot</div><div className="typing"><i /><i /><i /> {slow ? "Still working — the AI service is slow right now…" : "Thinking through your question…"}</div></div></div>}
                <div ref={bottomRef} />
              </div>
              {messages.length < 3 && <div className="starter-prompts">{starterPrompts.map((prompt) => <button key={prompt} onClick={() => sendMessage(prompt)} disabled={busy}>{prompt}</button>)}</div>}
              <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Ask about skills, jobs, interviews, or your learning plan…" rows={2} maxLength={4000} /><div className="composer-footer"><span>Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={busy || !question.trim()}>{busy ? "Thinking…" : "Send message"} <span>↗</span></button></div></form>
            </div>
          </section>
        ) : (
          <section className="roadmap-layout">
            <div className="roadmap-intro"><div className="sparkle">↗</div><span className="eyebrow">YOUR PLAN, YOUR PACE</span><h2>Turn your target role into a plan.</h2><p>Choose a role, your current level, and a timeframe. Gemini will create a practical learning roadmap with projects and checkpoints.</p></div>
            <form className="roadmap-form" onSubmit={generateRoadmap}>
              <label>Target role<input value={targetRole} onChange={(event) => setTargetRole(event.target.value)} required maxLength={100} placeholder="e.g. Cloud Engineer" /></label>
              <div className="form-grid"><label>Current level<select value={level} onChange={(event) => setLevel(event.target.value)}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><label>Timeframe<select value={months} onChange={(event) => setMonths(event.target.value)}><option value="1">1 month</option><option value="3">3 months</option><option value="6">6 months</option><option value="8">8 months</option><option value="12">12 months</option></select></label></div>
              <button className="generate-button" type="submit" disabled={roadmapBusy}>{roadmapBusy ? "Building your roadmap…" : "✦ Generate my roadmap"}</button>
            </form>
            {roadmap && <div className="roadmap-result"><div className="result-heading"><div><span className="eyebrow">GENERATED FOR YOU</span><h2>{targetRole} roadmap</h2></div><button className="copy-button" onClick={() => navigator.clipboard?.writeText(roadmap).catch(() => {})}>Copy plan</button></div><MessageContent text={roadmap} /></div>}
          </section>
        )}
        <footer className="footer-note">AI can make mistakes. Verify important career, certification, and hiring information with official sources.</footer>
      </main>
    </div>
  );
}
