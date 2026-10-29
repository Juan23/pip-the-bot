// Telegram bridge: Juan's messages to the Telegram bot go to the bot's conversation, and its replies go back.
// Needs ~/bot/.telegram (token from @BotFather) and ~/bot/.telegram-chat (Juan's Telegram user id). Off without the token.
import { join } from "node:path";

export type Done = (result: { reply: string } | { error: string }) => void;
export type Enqueue = (text: string, done: Done) => { status: number; error: string } | null;

export const TELEGRAM_PREFIX = "[telegram] ";
const MAX_LENGTH = 4096; // Telegram's limit per message

const unanswered = new Map<number, number>(); // Telegram message id → chat id, until its reply is sent
let say = async (_chatId: number, _text: string) => {};

// Called on shutdown: queued messages die with the server, so say so instead of going silent.
export async function stopTelegram() {
  await Promise.all([...unanswered.values()].map((chat) =>
    say(chat, "My Mac app closed before I could answer that. Send it again once the app is running.")));
  unanswered.clear();
}

export async function readText(path: string) {
  const file = Bun.file(path);
  return (await file.exists()) ? (await file.text()).trim() : null;
}

export async function startTelegram(bot: string, enqueue: Enqueue) {
  const token = await readText(join(bot, ".telegram"));
  if (!token) return;
  const owner = Number(await readText(join(bot, ".telegram-chat")));
  const offsetFile = join(bot, ".telegram-offset");
  let offset = Number(await readText(offsetFile)) || 0;

  const api = async (method: string, body: object) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(70_000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.description}`);
    return data.result;
  };
  say = async (chat_id: number, text: string) => {
    for (let i = 0; i < text.length; i += MAX_LENGTH) {
      await api("sendMessage", { chat_id, text: text.slice(i, i + MAX_LENGTH) }).catch((e) => console.error("telegram:", e.message));
    }
  };

  // Only Juan, in a private chat with the bot. Anyone else is ignored; their id is logged for pairing.
  const handle = (m: any) => {
    if (!m) return;
    if (!owner || m.from?.id !== owner || m.chat?.type !== "private") {
      console.log(`telegram: ignored a message from id ${m.from?.id} (@${m.from?.username})`);
      return;
    }
    if (!m.text) return void say(m.chat.id, "I can only read text messages for now.");
    const typing = () => api("sendChatAction", { chat_id: m.chat.id, action: "typing" }).catch(() => {});
    typing();
    const timer = setInterval(typing, 4500); // Telegram shows "typing…" for 5 s per call
    // a forward is someone else's words: label it so it's never read as Juan's own instruction
    const text = m.forward_origin ? `(Juan forwarded this; someone else wrote it:)\n${m.text}` : m.text;
    unanswered.set(m.message_id, m.chat.id);
    const rejected = enqueue(TELEGRAM_PREFIX + text, (result) => {
      unanswered.delete(m.message_id);
      clearInterval(timer);
      say(m.chat.id, "reply" in result ? result.reply || "(no reply)" : `Something went wrong: ${result.error}`);
    });
    if (rejected) {
      unanswered.delete(m.message_id);
      clearInterval(timer);
      say(m.chat.id, rejected.error);
    }
  };

  for (let backoff = 1000; ; ) {
    try {
      for (const update of await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] })) {
        offset = update.update_id + 1;
        await Bun.write(offsetFile, String(offset)); // saved before handling: after a crash, skip a message rather than act on it twice
        handle(update.message);
      }
      backoff = 1000;
    } catch (e) {
      console.error("telegram:", e instanceof Error ? e.message : e);
      await Bun.sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}
