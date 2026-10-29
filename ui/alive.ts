// Whether the bot script that wrote a pid file (.running, .terminal) still runs. A file from before the last boot
// is left over from a hard stop, and its pid may belong to another process by now.
import { stat } from "node:fs/promises";
import { uptime } from "node:os";

export async function alive(path: string) {
  try {
    const pid = Number(await Bun.file(path).text());
    if (!(pid > 0) || (await stat(path)).mtimeMs < Date.now() - uptime() * 1000) return false;
    process.kill(pid, 0); // throws when no such process is ours
    return true;
  } catch {
    return false;
  }
}
