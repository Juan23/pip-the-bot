// Pip's conversation as the pages show it: Juan's prompts, wakes and worker reports, and Pip's replies.
import { stat } from "node:fs/promises";
import { TELEGRAM_PREFIX } from "./telegram.ts";

export const WORKER_PREFIX = "[worker ";

// role "wake" is any turn Juan didn't start: Pip waking itself, or (via "worker") a worker reporting in
type Item = { role: "you" | "wake" | "bot"; text: string; at: string; tools?: string[]; via?: "telegram" | "worker" };

function promptText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((b) => b?.type === "tool_result")) return null;
  return content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") || null;
}

// What's parsed of the conversation file so far: the pages refresh every few seconds and the file only grows.
let seen: { path: string; ino: number; offset: number; items: Item[]; reply: Item | null } | null = null;
let reading: Promise<unknown> = Promise.resolve();

// One read at a time: two reads from the same offset would add its turns twice.
export function readHistory(path: string, limit: number) {
  const result = reading.then(() => read(path, limit));
  reading = result.catch(() => {});
  return result;
}

async function read(path: string, limit: number): Promise<Item[]> {
  const info = await stat(path).catch(() => null);
  if (!info) return [];
  // a new session, or the file was replaced or cut short: start over
  if (seen?.path !== path || seen.ino !== info.ino || info.size < seen.offset) seen = { path, ino: info.ino, offset: 0, items: [], reply: null };
  const start = seen.offset;
  const bytes = await Bun.file(path).slice(start, info.size).bytes();
  const lines = new TextDecoder().decode(bytes).split("\n");
  seen.offset = start + bytes.lastIndexOf(10) + 1; // after the last newline; a half-written line is read again next time
  const { items } = seen;
  let { reply } = seen;
  for (const [i, line] of lines.entries()) {
    let e;
    try { e = JSON.parse(line); } catch { continue; } // blank, or the line claude is still writing
    if (i === lines.length - 1) seen.offset = start + bytes.length; // it parses, so it's whole even before its newline
    if (e.type === "user" && !e.isMeta && !e.isCompactSummary) {
      const text = promptText(e.message?.content)?.trim();
      if (!text || text.startsWith("<command-") || text.startsWith("<local-command-")) continue; // tool results, slash-command echoes
      reply = null;
      if (text.startsWith(TELEGRAM_PREFIX)) items.push({ role: "you", text: text.slice(TELEGRAM_PREFIX.length), at: e.timestamp, via: "telegram" });
      else if (text.startsWith(WORKER_PREFIX)) items.push({ role: "wake", text, at: e.timestamp, via: "worker" });
      else items.push({ role: text.startsWith("[wake]") ? "wake" : "you", text, at: e.timestamp });
    } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type !== "text" && b.type !== "tool_use") continue;
        if (!reply) items.push((reply = { role: "bot", text: "", at: e.timestamp, tools: [] }));
        reply.at = e.timestamp;
        if (b.type === "text" && b.text.trim()) reply.text = [reply.text, b.text.trim()].filter(Boolean).join("\n\n");
        if (b.type === "tool_use" && !reply.tools!.includes(b.name)) reply.tools!.push(b.name);
      }
    }
  }
  seen.reply = reply;
  return items.slice(-limit);
}
