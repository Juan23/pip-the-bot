// Tests for readText, which the server and the Telegram bridge use for the bot's small state files.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readText } from "./telegram.ts";

test("readText trims a file's text, and gives null for a missing file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pip-read-"));
  writeFileSync(join(dir, ".session"), "  abc-123\n");
  expect(await readText(join(dir, ".session"))).toBe("abc-123");
  expect(await readText(join(dir, "missing"))).toBeNull();
});
