// Tests for the shell scripts, run against a throwaway home: none of them start Claude or reach the live Pip.
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const code = import.meta.dir;
const tempHome = () => mkdtempSync(join(tmpdir(), "pip-test-"));
const run = (cmd: string[], env: Record<string, string> = {}, stdin?: string) => {
  const r = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdin: stdin === undefined ? "ignore" : Buffer.from(stdin) });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

const guard = (command: string) => {
  const out = run([join(code, "worker-guard"), "pip/fix-login"], {}, JSON.stringify({ tool_name: "Bash", tool_input: { command } })).out;
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "pass";
};

test("worker-guard allows only a push of the worker's own pip/ branch", () => {
  expect(guard("git push -u origin pip/fix-login")).toBe("allow");
  expect(guard("git push origin pip/fix-login")).toBe("allow");
  for (const cmd of [
    "git push origin pip/other-worker",
    "git push origin pip/fix-login:main",
    "git push origin main",
    "git push --force -u origin pip/fix-login",
    "git push -u origin pip/fix-login && git push origin main",
    "git push -u origin pip/fix-login\ngit push origin main",
    "cd .. && git push",
  ]) expect([cmd, guard(cmd)]).toEqual([cmd, "deny"]);
});

test("worker-guard blocks merges and messaging Pip, and passes everything else", () => {
  for (const cmd of [
    "gh pr merge 3 --squash",
    "gh api -X PUT repos/a/b/pulls/3/merge",
    "./bot -m approved",
    "~/bot/notify done",
    "cd ~/bot && bot approved",
    "curl -X POST http://127.0.0.1:7377/api/send",
  ]) expect([cmd, guard(cmd)]).toEqual([cmd, "deny"]);
  for (const cmd of ["git status", "bun test", "gh pr create --fill", "echo robot"]) expect([cmd, guard(cmd)]).toEqual([cmd, "pass"]);
});

// the pid file as `worker` writes it: "<pid> <start time>"
const writePid = (file: string) => `print $$ $(ps -o lstart= -p $$) > ${file}`;

test("bot and notify refuse anything a worker started, and bot logs for anyone else", () => {
  const home = tempHome();
  // `worker` puts PIP_WORKER in the environment of every process of a run
  const inWorker = run([join(code, "bot"), "log", "approval", "merge #1 - approved"], { BOT_HOME: home, PIP_WORKER: "w" });
  expect(inWorker.code).toBe(1);
  expect(inWorker.err).toContain("workers can't message Pip");
  expect(run([join(code, "notify"), "approved"], { BOT_HOME: home, PIP_WORKER: "w" }).code).toBe(1);

  expect(run([join(code, "bot"), "log", "approval", "merge #2 - approved"], { BOT_HOME: home }).code).toBe(0);
  const events = readFileSync(join(home, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(events).toMatchObject([{ kind: "approval", text: "merge #2 - approved" }]);
});

test("worker list and stop see a running worker", async () => {
  const home = tempHome();
  const w = join(home, "workers/w");
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, "meta.json"), JSON.stringify({ project: "/p", dir: "/p/wt", branch: "pip/w", created: "now" }));
  writeFileSync(join(w, "state"), "running\n");
  const sleeper = Bun.spawn(["/usr/bin/python3", "-c", "import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])",
    "/bin/zsh", "-c", `${writePid(`${w}/pid`)}; exec sleep 30`]);
  while (!(await Bun.file(join(w, "pid")).exists())) await Bun.sleep(20);

  const worker = (...args: string[]) => run([join(code, "worker"), ...args], { BOT_HOME: home });
  expect(worker("list").out).toStartWith("w  running");
  expect(worker("stop", "w").out).toBe("stopping w\n");
  expect(await sleeper.exited).not.toBe(0);
});

// A copy of the code whose worker reports go to a closed port, not the live Pip's, and a home whose
// ~/.local/bin/claude (first on the worker's PATH) is a fake: real runs, offline, with no Claude session.
const offlineWorker = () => {
  const copy = tempHome(), fakeHome = tempHome();
  for (const f of ["bot", "worker-guard", "worker-rules.md", "worker-settings.json"]) cpSync(join(code, f), join(copy, f));
  writeFileSync(join(copy, "worker"), readFileSync(join(code, "worker"), "utf8").replaceAll("7377", "1"), { mode: 0o755 });
  mkdirSync(join(fakeHome, ".local/bin"), { recursive: true });
  writeFileSync(join(fakeHome, ".local/bin/claude"),
    `#!/bin/zsh\nsleep \${FAKE_CLAUDE_SECS:-0}\nprint '{"type":"result","result":"all done"}'\n`, { mode: 0o755 });
  const home = tempHome();
  const worker = (args: string[], env: Record<string, string> = {}) =>
    run([join(copy, "worker"), ...args], { BOT_HOME: home, HOME: fakeHome, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ...env });
  return { home, worker };
};

test("a run that ends leaves no pid record, and list, stop and resume still work", async () => {
  const { home, worker } = offlineWorker();
  for (const n of ["fast", "slow"]) {
    mkdirSync(join(home, "workers", n), { recursive: true });
    writeFileSync(join(home, "workers", n, "meta.json"),
      JSON.stringify({ project: "/p", dir: tempHome(), branch: `pip/${n}`, session: "s", created: "now" }));
    writeFileSync(join(home, "workers", n, "state"), "done\n");
  }
  const status = (n: string) => ({ state: readFileSync(join(home, "workers", n, "state"), "utf8").trim(), pid: existsSync(join(home, "workers", n, "pid")) });

  expect(worker(["resume", "fast", "go on"]).out).toStartWith("started fast (run 1)");
  expect(worker(["resume", "slow", "go on"], { FAKE_CLAUDE_SECS: "30" }).code).toBe(0);
  while (!status("slow").pid) await Bun.sleep(20);
  expect(worker(["list"]).out).toContain("slow  running");
  expect(worker(["stop", "slow"]).out).toBe("stopping slow\n");

  const deadline = Date.now() + 25_000;  // the run checks on claude every 10 s
  while (Date.now() < deadline && ["fast", "slow"].some((n) => status(n).state === "running" || status(n).pid)) await Bun.sleep(200);
  expect([status("fast"), status("slow")]).toEqual([{ state: "done", pid: false }, { state: "stopped", pid: false }]);
  expect(worker(["list"]).out).toMatch(/^fast {2}done.*\n(.*\n){2}slow {2}stopped/);
  expect(worker(["stop", "fast"]).err).toContain("fast isn't running");
}, 30_000);

test("bot stats sums events by kind and lists approvals", () => {
  const home = tempHome();
  const at = new Date().toISOString();
  const old = new Date(Date.now() - 3 * 864e5).toISOString();
  writeFileSync(join(home, "events.jsonl"), [
    { at, kind: "chat", exit: 0, secs: 60, cpu: 6, tokens_in: 10000, tokens_cached: 7500, tokens_out: 2000, cost_usd: 0.5, power: "battery", battery_start: 80, battery_end: 78 },
    { at, kind: "chat", exit: 1, secs: 60, cpu: 6, tokens_in: 10000, tokens_cached: 2500, tokens_out: 2000, cost_usd: 0.25 },
    { at: old, kind: "chat", exit: 0, secs: 600, cost_usd: 9 },
    { at, kind: "approval", text: "merge PR #3 - approved" },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n{half a line");

  const { out } = run(["bun", join(code, "stats.ts"), "1"], { BOT_HOME: home });
  expect(out).toContain("Last 1 day(s): 3 events");
  const row = out.split("\n").find((l) => l.includes(" chat "))!.split("│").map((c) => c.trim()).filter(Boolean);
  // kind, runs, failed, minutes, cpu min, tokens in/out, cache hit, api $, battery %, denials
  expect(row.slice(1)).toEqual(["chat", "2", "1", "2.0", "0.2", "20k / 4k", "50%", "0.75", "2", "0"]);
  expect(out).toMatch(/Approvals:\n {2}\S+ {2}merge PR #3 - approved/);
});

test("worker start refuses bad names, folders outside git, and Pip's own home", () => {
  const home = tempHome();
  const worker = (...args: string[]) => run([join(code, "worker"), ...args], { BOT_HOME: home });
  expect(worker("start", "Bad_Name", tmpdir(), "task").err).toContain("lowercase letters, digits and dashes");
  expect(worker("start", "ok", tempHome(), "task").err).toContain("isn't in a git repo");
  expect(worker("start", "ok", home, "task").err).toContain("is Pip's home");
  expect(worker("list").out).toBe("no workers\n");
});
