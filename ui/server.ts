// Local-only server behind the bot's interfaces: menu bar popover, chat window and journal.
// Run: `bot serve` (Bot.app starts it). Listens on 127.0.0.1:7377 only.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { alive } from "./alive.ts";
import { readHistory, WORKER_PREFIX } from "./history.ts";
import { readText, startTelegram, stopTelegram, type Done } from "./telegram.ts";

const PORT = 7377;
const UI = import.meta.dir;
const BOT = process.env.BOT_HOME || join(process.env.HOME!, "bot"); // the bot's home: conversation id, memory, private files
const SCRIPT = join(UI, "..", "bot");
const NOTIFY = join(UI, "..", "notify");
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));
const PAGES: Record<string, string> = { "/": "window.html", "/popover": "popover.html", "/journal": "journal.html" };
const STATIC_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml", png: "image/png",
};
const MAX_TEXT = 8000;
const MAX_QUEUED = 5;

let queue = Promise.resolve();
let queued = 0;
let lastError: { at: number; message: string } | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function succeeds(cmd: string[]) {
  return (await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited) === 0;
}

// Whether launchd's wake job is loaded. It rarely changes, so it's checked once a minute, not on every status answer.
const wakeJobLoaded = () => succeeds(["launchctl", "print", `gui/${process.getuid!()}/local.bot`]).catch(() => false);
let wakeJob = wakeJobLoaded();
setInterval(() => { wakeJob = wakeJobLoaded(); }, 60_000);

async function state() {
  const nextWake = Number(await readText(join(BOT, ".next-wake")));
  const terminalChat = await alive(join(BOT, ".terminal")); // `bot` is open in a terminal; messages from here wait for it to close
  return {
    name: (await readText(join(BOT, ".name"))) || "Your bot",
    busy: (await alive(join(BOT, ".running"))) || (queued > 0 && !terminalChat), // answering a message or awake on its own
    terminalChat,
    queued,
    nextWake: nextWake > 0 ? nextWake * 1000 : null,
    wakeJob: await wakeJob,
    lastError,
  };
}

async function history(limit: number) {
  const sid = await readText(join(BOT, ".session"));
  return sid ? readHistory(join(process.env.HOME!, ".claude/projects", BOT.replaceAll("/", "-"), `${sid}.jsonl`), limit) : [];
}

async function memory() {
  const dir = join(BOT, "memory");
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").sort();
  const parsed = await Promise.all(files.map(async (file) => {
    const raw = await Bun.file(join(dir, file)).text();
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const field = (key: string) =>
      m?.[1].match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1].replace(/^"(.*)"$/, "$1").replaceAll('\\"', '"') || null;
    return { file, name: field("name") ?? file.slice(0, -3), description: field("description"), body: (m ? m[2] : raw).trim() };
  }));
  const tasksFile = parsed.find((p) => p.file === "tasks.md");
  const tasks = (tasksFile?.body ?? "").split("\n")
    .map((l) => l.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/)?.[1].trim()).filter((t): t is string => !!t);
  return { memories: parsed.filter((p) => p !== tasksFile), tasks };
}

// Queues a message for the bot, or says why it can't. Used by the pages and the Telegram bridge.
function enqueue(text: string, done?: Done) {
  if (!text) return { status: 400, error: "Message is empty." };
  if (text.length > MAX_TEXT) return { status: 400, error: `Message is over ${MAX_TEXT} characters.` };
  if (queued >= MAX_QUEUED) return { status: 429, error: "The bot already has messages waiting. Try again in a moment." };
  queued++;
  // one at a time, in the order sent: the bot script's lock alone doesn't keep waiters in order
  queue = queue.then(async () => {
    const run = Bun.spawn([SCRIPT, "-m", text], { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([run.exited, new Response(run.stdout).text(), new Response(run.stderr).text()]);
    lastError = code === 0 ? null : { at: Date.now(), message: err.trim().slice(-500) || `The bot stopped with exit code ${code}.` };
    done?.(lastError ? { error: lastError.message } : { reply: out.trim() });
  }).catch((e) => { // e.g. the bot script can't be started; an unhandled rejection would kill the server
    lastError = { at: Date.now(), message: `Couldn't run the bot: ${e instanceof Error ? e.message : e}` };
    done?.({ error: lastError.message });
  }).finally(() => { queued--; });
  return null;
}

async function wakeNow() {
  await Bun.write(join(BOT, ".next-wake"), "0\n"); // if busy now, launchd's next check wakes it
  Bun.spawn([SCRIPT, "wake"], { stdout: "ignore", stderr: "ignore" });
}

async function serveStatic(pathname: string) {
  const name = PAGES[pathname] ?? pathname.slice(1);
  const type = STATIC_TYPES[name.split(".").pop()!];
  if (!type || name.includes("/") || name.startsWith(".")) return new Response("Not found", { status: 404 });
  const file = Bun.file(join(UI, name));
  const headers = { "Content-Type": type, "Cache-Control": "no-store", "Content-Security-Policy": "frame-ancestors 'none'" }; // no framing by other sites
  return (await file.exists()) ? new Response(file, { headers })
    : new Response("Not found", { status: 404 });
}

// Whether the process on the other end of a local connection was started by a running worker: a run's first process
// (workers/<name>/pid holds "<pid> <start time>") is among its ancestors. Claude Code gives each command its own
// process group, and ps can't read the environment of system tools like curl, so ancestry is what ties a command
// to its run. Workers must never speak as Juan: the Origin check stops browsers, not local programs.
async function fromWorker(port: number) {
  const dir = join(BOT, "workers");
  const ids = await Promise.all((await readdir(dir).catch(() => [])).map((n) => readText(join(dir, n, "pid"))));
  const runs = new Map(ids.filter((t): t is string => !!t).map((t) => [t.split(" ")[0], t.split(" ").slice(1).join(" ")]));
  if (!runs.size) return false;
  const ps = async (field: string, pid: string) =>
    (await new Response(Bun.spawn(["ps", "-o", `${field}=`, "-p", pid], { stdout: "pipe", stderr: "ignore" }).stdout).text()).trim();
  const lsof = Bun.spawn(["lsof", "-nP", "-t", `-iTCP@127.0.0.1:${port}`], { stdout: "pipe", stderr: "ignore" });
  for (const peer of (await new Response(lsof.stdout).text()).split("\n")) {
    if (!peer || Number(peer) === process.pid) continue;
    for (let pid = peer; pid && pid !== "1"; pid = await ps("ppid", pid)) {
      // the run itself, not a later process reusing its pid (after a reboot, say)
      if (runs.has(pid) && (await ps("lstart", pid)).split(/\s+/).join(" ") === runs.get(pid)) return true;
    }
  }
  return false;
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, server) {
    // The API drives an agent with your files and browser: only pages served from here may use it.
    if (!HOSTS.has(req.headers.get("host") ?? "")) return new Response("Forbidden", { status: 403 }); // DNS rebinding
    const { pathname, searchParams } = new URL(req.url);
    if (req.method === "POST") {
      if (!ORIGINS.has(req.headers.get("origin") ?? "")) return json({ error: "Forbidden origin" }, 403); // other sites
      const peer = server.requestIP(req);
      if (peer && (await fromWorker(peer.port))) return json({ error: "Workers can't message Pip; put it in your report." }, 403);
      if (pathname === "/api/wake") {
        const s = await state();
        if (s.terminalChat) return json({ error: `Close the Terminal chat first: ${s.name} can't wake up while it's open.` }, 409);
        if (s.busy) return json({ error: `${s.name} is already awake.` }, 409);
        return (await wakeNow(), json({ ok: true }, 202));
      }
      if (pathname === "/api/message") {
        const body = await req.json().catch(() => null);
        const rejected = enqueue(typeof body?.text === "string" ? body.text.trim() : "");
        return rejected ? json({ error: rejected.error }, rejected.status) : json({ queued }, 202);
      }
      // A worker reporting in (from the `worker` script). Pip's reply is for Juan, wherever he is: Mac and Telegram.
      if (pathname === "/api/event") {
        const body = await req.json().catch(() => null);
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text.startsWith(WORKER_PREFIX)) return json({ error: `Events must start with "${WORKER_PREFIX}".` }, 400);
        const rejected = enqueue(text, (result) => {
          Bun.spawn([NOTIFY, "reply" in result ? result.reply || "Pip read a worker report and had nothing to add."
            : `Couldn't handle a worker report: ${result.error}`]);
        });
        return rejected ? json({ error: rejected.error }, rejected.status) : json({ queued }, 202);
      }
      return json({ error: "Not found" }, 404);
    }
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (pathname === "/api/state") return json(await state());
    if (pathname === "/api/history") {
      const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 200, 1), 1000);
      return json(await history(limit));
    }
    if (pathname === "/api/memory") return json(await memory());
    return serveStatic(pathname);
  },
});
console.log(`bot interface on http://127.0.0.1:${PORT}`);
startTelegram(BOT, (text, done) => enqueue(text.trim(), done)).catch((e) => console.error("telegram stopped:", e));

// Bot.app stops the server on quit: messages still queued here are dropped, so tell Telegram senders.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await Promise.race([stopTelegram(), Bun.sleep(3000)]);
    process.exit(0);
  });
}
