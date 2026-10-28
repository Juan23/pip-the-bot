// Client for the bot's local server (server.ts). Every page talks to the bot through this module.

async function call(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server answered ${res.status}.`);
  return body;
}

// { name, busy (answering or awake), terminalChat (`bot` open in a terminal: sent messages wait until it closes), queued,
//   nextWake (ms epoch | null), wakeJob (background wake-ups installed?), lastError ({at, message} | null) }
export const getState = () => call("/api/state");
// [{ role: "you" | "wake" | "bot", text, at (ISO time), tools?: [tool names], via?: "telegram" }], oldest first
export const getHistory = (limit = 200) => call(`/api/history?limit=${limit}`);
// { memories: [{ file, name, description, body }], tasks: [text] }
export const getMemory = () => call("/api/memory");
// Queues a message; the reply shows up in getHistory() once the bot answers (state.busy goes false).
export const sendMessage = (text) =>
  call("/api/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
export const wakeNow = () => call("/api/wake", { method: "POST" });

// Calls fn now and every `ms` while the page is visible. Returns a stop function.
export function watch(fn, ms = 3000) {
  let timer;
  const tick = async () => {
    clearTimeout(timer);
    if (document.visibilityState === "visible") await fn();
    timer = setTimeout(tick, ms);
  };
  document.addEventListener("visibilitychange", tick);
  tick();
  return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", tick); };
}

// Human name for a tool the bot used, or null for internal ones not worth showing.
export function toolLabel(name) {
  if (name === "ToolSearch" || name === "TodoWrite") return null;
  if (name.startsWith("mcp__claude-in-chrome__")) return "Chrome";
  const mcp = name.match(/^mcp__(?:claude_ai_)?([^_]+(?:_[^_]+)*?)__/);
  if (mcp) return mcp[1].replaceAll("_", " ");
  if (name === "Bash") return "Terminal";
  if (["Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit"].includes(name)) return "Files";
  if (name === "WebSearch" || name === "WebFetch") return "Web";
  return name;
}

export const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// "Today", "Yesterday", "Tomorrow", else "Wed 28 Oct".
export function dayLabel(date) {
  const d = new Date(date), today = new Date();
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 864e5);
  return { 0: "Today", "-1": "Yesterday", 1: "Tomorrow" }[days]
    ?? d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

// The bot writes light Markdown. Escapes everything first, then allows **bold**, `code`, "- " lists and paragraphs.
export function renderText(text) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}
