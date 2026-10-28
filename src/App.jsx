import { useEffect, useState } from "react";
import "./App.css";

const initialTasks = [
  { id: 1, title: "Learn JavaScript fundamentals", category: "Frontend", done: true },
  { id: 2, title: "Build your first React component", category: "Frontend", done: true },
  { id: 3, title: "Understand REST APIs", category: "Backend", done: false },
  { id: 4, title: "Create a Python API", category: "AI Engineering", done: false },
];

const roadmap = [
  { week: "01–02", title: "Web foundations", detail: "HTML, CSS, JavaScript and Git", status: "Completed" },
  { week: "03–05", title: "React & modern frontend", detail: "Components, props, state and routing", status: "In progress" },
  { week: "06–09", title: "Python & backend APIs", detail: "Python, FastAPI, REST and SQL", status: "Upcoming" },
  { week: "10–13", title: "AI application development", detail: "LLM APIs, prompts and structured output", status: "Upcoming" },
  { week: "14–18", title: "Build an AI product", detail: "RAG, evaluation and project deployment", status: "Upcoming" },
];

const skills = [
  ["HTML, CSS & JavaScript", "Frontend"], ["React", "Frontend"],
  ["Python", "Programming"], ["FastAPI & REST APIs", "Backend"],
  ["SQL & Databases", "Data"], ["LLMs & RAG", "AI Engineering"],
];

const projects = [
  ["AI Career Copilot", "Current project", "Build a career planning assistant."],
  ["AI PDF Assistant", "Next project", "Ask questions about documents with cited answers."],
  ["AI Shopping Assistant", "Portfolio project", "Add intelligent product discovery to an online store."],
];

function loadTasks() {
  try {
    const saved = localStorage.getItem("career-copilot-tasks");
    if (!saved) return initialTasks;
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : initialTasks;
  } catch {
    return initialTasks;
  }
}

export default function App() {
  const [activeNav, setActiveNav] = useState("Overview");
  const [tasks, setTasks] = useState(loadTasks);
  const [question, setQuestion] = useState("");
  const [coachMessage, setCoachMessage] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem("career-copilot-tasks", JSON.stringify(tasks));
    } catch (error) {
      console.error("Unable to save tasks:", error);
    }
  }, [tasks]);

  const completed = tasks.filter((task) => task.done).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  function toggleTask(id) {
    setTasks((current) => current.map((task) =>
      task.id === id ? { ...task, done: !task.done } : task
    ));
  }

  function askAssistant(event) {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    setCoachMessage(`Your question: “${value}”\n\nThe AI service is not connected yet. We'll connect a secure backend and real AI model in Phase 3.`);
    setQuestion("");
  }

  function RoadmapList() {
    return <div className="roadmap-list">{roadmap.map((item, index) => (
      <article className="roadmap-item" key={item.week}>
        <div className={`roadmap-marker ${item.status === "Completed" ? "marker-done" : item.status === "In progress" ? "marker-current" : ""}`}>
          {item.status === "Completed" ? "✓" : String(index + 1).padStart(2, "0")}
        </div>
        <div className="roadmap-details">
          <div className="roadmap-meta">WEEK {item.week}</div>
          <h3>{item.title}</h3><p>{item.detail}</p>
        </div>
        <span className={`status-pill ${item.status.toLowerCase().replace(" ", "-")}`}>{item.status}</span>
      </article>
    ))}</div>;
  }

  function renderPage() {
    if (activeNav === "Overview") return <>
      <section className="welcome-row">
        <div><div className="eyebrow"><span className="status-dot" /> YOUR CAREER JOURNEY STARTS HERE</div>
          <h1>Build your future, <span>one skill at a time.</span></h1>
          <p className="subtitle">Your personal space to learn, build projects, and prepare for your next opportunity.</p>
        </div>
        <button className="primary-button" onClick={() => setActiveNav("Learning Roadmap")}>Explore roadmap <span>↗</span></button>
      </section>
      <section className="hero-card">
        <div className="hero-copy">
          <div className="hero-tag"><span>✳</span> YOUR PERSONAL CAREER COPILOT</div>
          <h2>Turn your ambition<br />into <span>real-world skills.</span></h2>
          <p>Learn the right things, build meaningful projects, and track your progress toward becoming an AI engineer.</p>
          <button className="hero-button" onClick={() => setActiveNav("Learning Roadmap")}>Continue learning <span>→</span></button>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="orbit-center">✳</div><div className="float-card float-top"><span>⌘</span><div><b>Build</b><small>Real projects</small></div></div><div className="float-card float-bottom"><span>↗</span><div><b>Grow</b><small>Every single day</small></div></div></div>
      </section>
      <section className="stats-grid">
        <article className="stat-card"><div className="stat-top"><span>Learning progress</span><span className="stat-icon purple">◔</span></div><div className="stat-value">{progress}<small>%</small></div><div className="mini-progress"><span style={{ width: `${progress}%` }} /></div><p>{completed} of {tasks.length} starter tasks completed</p></article>
        <article className="stat-card"><div className="stat-top"><span>Skills to develop</span><span className="stat-icon orange">◇</span></div><div className="stat-value">06</div><p>Frontend, backend, Python, AI, SQL, Git</p></article>
        <article className="stat-card"><div className="stat-top"><span>Portfolio projects</span><span className="stat-icon green">▧</span></div><div className="stat-value">03</div><p>Build, publish, and explain your work</p></article>
      </section>
      <div className="content-grid">
        <section className="panel roadmap-panel"><div className="panel-heading"><div><h2>Your learning roadmap</h2><p>A practical path from fundamentals to AI applications.</p></div><button className="text-button" onClick={() => setActiveNav("Learning Roadmap")}>View all ↗</button></div><RoadmapList /></section>
        <section className="panel tasks-panel"><div className="panel-heading"><div><h2>Today's focus</h2><p>Small steps add up.</p></div><span className="today-icon">✦</span></div>
          <div className="task-progress-label"><span>Starter checklist</span><strong>{completed}/{tasks.length}</strong></div><div className="mini-progress task-bar"><span style={{ width: `${progress}%` }} /></div>
          <div className="task-list">{tasks.map((task) => <label className={`task-item ${task.done ? "task-done" : ""}`} key={task.id}><input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} /><span className="custom-check">{task.done ? "✓" : ""}</span><span className="task-text"><strong>{task.title}</strong><small>{task.category}</small></span></label>)}</div>
          <div className="encouragement"><span>✳</span><p><strong>Consistency beats intensity.</strong><br />Keep showing up, even for 30 minutes.</p></div>
        </section>
      </div>
      <section className="assistant-banner"><div className="assistant-symbol">✳</div><div className="assistant-copy"><h2>Stuck on what to learn next?</h2><p>Your AI coach interface is ready. We'll connect it to a real AI model in Phase 3.</p></div><button className="primary-button" onClick={() => setActiveNav("AI Coach")}>Open AI Coach <span>→</span></button></section>
    </>;

    if (activeNav === "Learning Roadmap") return <section className="panel feature-page"><div className="panel-heading"><div><h2>Your learning roadmap</h2><p>A practical path from fundamentals to AI applications.</p></div></div><RoadmapList /></section>;

    if (activeNav === "Skills") return <section className="panel feature-page"><div className="panel-heading"><div><h2>Skills to develop</h2><p>Learn each skill through practice and projects.</p></div></div><div className="feature-grid">{skills.map(([skill, category]) => <article className="feature-card" key={skill}><span className="roadmap-meta">{category}</span><h3>{skill}</h3><p>Learn the fundamentals and build a practical project.</p></article>)}</div></section>;

    if (activeNav === "Projects") return <section className="panel feature-page"><div className="panel-heading"><div><h2>Portfolio projects</h2><p>Build, publish, and explain your work.</p></div></div><div className="feature-grid">{projects.map(([name, status, description]) => <article className="feature-card" key={name}><span className="roadmap-meta">{status}</span><h3>{name}</h3><p>{description}</p></article>)}</div></section>;

    return <section className="panel feature-page"><div className="coach-content"><div className="assistant-symbol">✳</div><h2>AI Career Coach</h2><p>Ask a question about programming, AI, projects, or your learning roadmap. This prototype confirms your question; live AI answers will be added in Phase 3.</p><form className="assistant-form" onSubmit={askAssistant}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. What should I learn in React first?" aria-label="Ask the career coach" /><button type="submit" aria-label="Submit question">→</button></form>{coachMessage && <pre className="coach-message">{coachMessage}</pre>}</div></section>;
  }

  const navItems = [["Overview", "◫"], ["Learning Roadmap", "▤"], ["Skills", "◇"], ["AI Coach", "✳"], ["Projects", "▧"]];

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand brand-button" onClick={() => setActiveNav("Overview")}><span className="brand-mark">✳</span><span>career<span className="brand-light">copilot</span></span></button>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="nav-list" aria-label="Main navigation">{navItems.map(([name, icon]) => <button key={name} className={`nav-item ${activeNav === name ? "active" : ""}`} onClick={() => setActiveNav(name)}><span className="nav-icon">{icon}</span>{name}{name === "AI Coach" && <span className="nav-badge">AI</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="goal-card"><div className="goal-icon">↗</div><p className="goal-label">YOUR CAREER GOAL</p><h3>AI Engineer</h3><p>Build skills. Ship projects. Get job-ready.</p><div className="goal-line"><span /></div><small>One step at a time</small></div><div className="profile"><div className="avatar">S</div><div><strong>Your workspace</strong><small>Career explorer</small></div><span className="profile-dots">···</span></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {activeNav}</div><div className="topbar-right"><span className="streak">✦ Keep your streak going</span><div className="top-avatar">S</div></div></header><div className="page-content">{renderPage()}<footer className="footer"><span>✳ career<span className="brand-light">copilot</span></span><span>Made for your next chapter.</span></footer></div></main>
  </div>;
}
