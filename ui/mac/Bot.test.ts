// Tests for the menu bar app: a copy of it, built on a free port with a fake `bot` beside it, so they never reach the live Pip.
// While they run, a second robot shows in the menu bar.
import { afterEach, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

const root = mkdtempSync(join(tmpdir(), "pip-app-test-"));
const app = join(root, "ui/Bot.app/Contents/MacOS/Bot");

beforeAll(() => {
  const free = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = free.port;
  free.stop(true);
  mkdirSync(join(root, "ui/mac"), { recursive: true });
  const copy = (file: string, from: string, to: string) =>
    writeFileSync(join(root, "ui/mac", file), readFileSync(join(import.meta.dir, file), "utf8").replace(from, to), { mode: 0o755 });
  copy("Bot.swift", "127.0.0.1:7377", `127.0.0.1:${port}`);
  copy("build.sh", "local.bot.ui", "local.bot.ui.test");
  const build = Bun.spawnSync([join(root, "ui/mac/build.sh")]);
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
}, 120_000);

// The app runs <root>/bot serve; this one records each start's pid, then runs `body`.
const fakeBot = (body: string) => {
  writeFileSync(join(root, "starts"), "");
  writeFileSync(join(root, "bot"), `#!/bin/zsh\nprint $$ >> ${root}/starts\n${body}\n`);
  chmodSync(join(root, "bot"), 0o755);
};
const starts = () => readFileSync(join(root, "starts"), "utf8").split("\n").filter(Boolean).map(Number);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ok: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; !ok(); await Bun.sleep(200)) if (Date.now() > end) throw new Error(`timed out: ${ok}`);
};

let running: Subprocess | undefined;
const launch = () => (running = Bun.spawn([app], { stdout: "ignore", stderr: "pipe" }));
// A failed test may leave its app and fake server running: stop them before the next test.
afterEach(() => {
  if (running?.exitCode === null) running.kill(9);
  for (const pid of starts()) if (alive(pid)) process.kill(pid, 9);
});
// Quit the way the menu does: a quit event to this process only, so the live Bot.app is never touched. Returns the app's stderr.
const quit = async (p: Subprocess<"ignore", "ignore", "pipe">) => {
  Bun.spawnSync(["osascript", "-l", "JavaScript", "-e",
    `ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${p.pid}).terminate`]);
  await until(() => p.exitCode !== null, 5000);
  return new Response(p.stderr).text();
};

test("a server that exits right away is restarted 5 times, then the app stops and says why", async () => {
  fakeBot(`print -u2 "error: Unexpected token"; exit 1`);
  const p = launch();
  await until(() => starts().length >= 6, 20_000);
  await Bun.sleep(5000);  // longer than the 2-second wait before a restart
  expect(starts()).toHaveLength(6);
  expect(await quit(p)).toMatch(/server is down.*error: Unexpected token/s);
}, 40_000);

test("a server that crashes once after running fine is restarted, and quitting the app stops it", async () => {
  fakeBot(`(( $(wc -l < ${root}/starts) > 1 )) && exec sleep 600\nsleep 1; exit 1`);
  const p = launch();
  await until(() => starts().length === 2, 10_000);
  const server = starts()[1];
  expect(alive(server)).toBe(true);
  await quit(p);
  await until(() => !alive(server), 5000);
}, 30_000);
