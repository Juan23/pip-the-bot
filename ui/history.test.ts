// Tests for reading the conversation file, against a sample one in a throwaway folder.
import { expect, test } from "bun:test";
import { appendFileSync, closeSync, mkdtempSync, openSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHistory } from "./history.ts";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "pip-history-")), "session.jsonl");
const at = (n: number) => `2026-10-29T10:00:0${n}.000Z`;
const user = (n: number, content: unknown, extra = {}) => JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: at(n), ...extra });
const assistant = (n: number, ...content: unknown[]) => JSON.stringify({ type: "assistant", message: { role: "assistant", content }, timestamp: at(n) });

// A sample conversation: everything history shows, and everything it skips.
const SAMPLE = [
  JSON.stringify({ type: "summary", summary: "not a turn" }),
  user(0, "Caveat: meta lines aren't prompts", { isMeta: true }),
  user(0, "<command-name>/clear</command-name>"),
  user(1, "Plan the café trip ☕"),
  assistant(2, { type: "thinking", thinking: "hidden" }, { type: "text", text: "Looking." }),
  assistant(3, { type: "tool_use", name: "Bash", input: {} }),
  user(3, [{ type: "tool_result", content: "ok" }]),
  assistant(4, { type: "tool_use", name: "Read", input: {} }, { type: "tool_use", name: "Bash", input: {} }),
  assistant(5, { type: "text", text: "  Booked.  " }),
  user(6, "[telegram] Thanks"),
  assistant(7, { type: "text", text: "Any time." }),
  user(8, [{ type: "text", text: "[worker fix-login] PR #3 is open" }]),
  user(8, "Summary of earlier turns", { isCompactSummary: true }),
  user(9, "[wake] Morning check"),
  "",
].join("\n");

const EXPECTED = [
  { role: "you", text: "Plan the café trip ☕", at: at(1) },
  { role: "bot", text: "Looking.\n\nBooked.", at: at(5), tools: ["Bash", "Read"] },
  { role: "you", text: "Thanks", at: at(6), via: "telegram" },
  { role: "bot", text: "Any time.", at: at(7), tools: [] },
  { role: "wake", text: "[worker fix-login] PR #3 is open", at: at(8), via: "worker" },
  { role: "wake", text: "[wake] Morning check", at: at(9) },
];

test("history shows prompts, replies and labels, and skips tool results and meta lines", async () => {
  const file = tempFile();
  writeFileSync(file, SAMPLE);
  expect(await readHistory(file, 200)).toEqual(EXPECTED);
  expect(await readHistory(file, 2)).toEqual(EXPECTED.slice(-2));
  expect(await readHistory(join(file, "..", "missing.jsonl"), 200)).toEqual([]);
});

test("after the first read, only the bytes added since are parsed", async () => {
  const file = tempFile();
  writeFileSync(file, SAMPLE);
  await readHistory(file, 200);
  // rewrite an already-read prompt in place: a read from the start would show the new words
  const fd = openSync(file, "r+");
  writeSync(fd, "Skip", Buffer.from(SAMPLE).indexOf("Plan the café"));
  closeSync(fd);
  appendFileSync(file, assistant(9, { type: "text", text: "All quiet." }) + "\n");
  expect(await readHistory(file, 200)).toEqual([...EXPECTED, { role: "bot", text: "All quiet.", at: at(9), tools: [] }]);
  // a reply that goes on after a read stays one reply
  appendFileSync(file, assistant(9, { type: "tool_use", name: "Grep", input: {} }) + "\n");
  expect((await readHistory(file, 1))[0]).toEqual({ role: "bot", text: "All quiet.", at: at(9), tools: ["Grep"] });
});

test("pages refreshing at the same moment don't see turns twice", async () => {
  const file = tempFile();
  writeFileSync(file, SAMPLE);
  expect(await Promise.all([readHistory(file, 200), readHistory(file, 200)])).toEqual([EXPECTED, EXPECTED]);
});

test("a new session, or a conversation file replaced or cut short, is read from the start", async () => {
  const file = tempFile();
  writeFileSync(file, SAMPLE);
  await readHistory(file, 200);
  writeFileSync(file, user(1, "Shorter") + "\n"); // the same file, cut short
  expect(await readHistory(file, 200)).toEqual([{ role: "you", text: "Shorter", at: at(1) }]);
  writeFileSync(file + ".new", SAMPLE); // a new file in its place, longer than what was read
  renameSync(file + ".new", file);
  expect(await readHistory(file, 200)).toEqual(EXPECTED);
  const next = tempFile();
  writeFileSync(next, user(1, "New session") + "\n");
  expect(await readHistory(next, 200)).toEqual([{ role: "you", text: "New session", at: at(1) }]);
});

test("a half-written last line is shown once it's complete", async () => {
  const file = tempFile();
  writeFileSync(file, SAMPLE);
  const line = Buffer.from(user(9, "Café later? ☕") + "\n");
  const cut = line.indexOf("☕") + 1; // in the middle of a character
  appendFileSync(file, line.subarray(0, cut));
  expect(await readHistory(file, 200)).toEqual(EXPECTED);
  appendFileSync(file, line.subarray(cut));
  expect(await readHistory(file, 200)).toEqual([...EXPECTED, { role: "you", text: "Café later? ☕", at: at(9) }]);
  // a whole line still waiting for its newline is shown, and only once
  appendFileSync(file, assistant(9, { type: "text", text: "Sure." }));
  expect(await readHistory(file, 1)).toEqual([{ role: "bot", text: "Sure.", at: at(9), tools: [] }]);
  appendFileSync(file, "\n" + user(9, "[wake] Later") + "\n");
  expect((await readHistory(file, 200)).slice(-3).map((i) => i.text)).toEqual(["Café later? ☕", "Sure.", "[wake] Later"]);
});
