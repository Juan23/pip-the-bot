// Tests for alive, which tells the server whether the bot script that wrote a pid file still runs.
import { expect, test } from "bun:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive } from "./alive.ts";

test("a pid file counts only while its process lives and only if written since boot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pip-alive-"));
  const file = (name: string, text: string) => (writeFileSync(join(dir, name), text), join(dir, name));
  const ended = Bun.spawn(["true"]);
  await ended.exited;

  expect(await alive(file("live", `${process.pid}\n`))).toBe(true);
  expect(await alive(file("dead", `${ended.pid}\n`))).toBe(false);
  expect(await alive(join(dir, "missing"))).toBe(false);
  expect(await alive(file("empty", ""))).toBe(false); // pid 0 would signal our own process group
  const stale = file("stale", `${process.pid}\n`);
  utimesSync(stale, 0, 0); // left by a bot killed before the last boot; its pid may belong to anything now
  expect(await alive(stale)).toBe(false);
});
