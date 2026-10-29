// `bot stats [days]`: what Pip and its workers cost over the last N days, from ~/bot/events.jsonl.
// cost_usd is the API price of the tokens: Pip runs on a subscription, so read it as a usage measure, not a bill.
const home = process.env.BOT_HOME || `${process.env.HOME}/bot`;
const days = Math.max(Number(process.argv[2]) || 1, 0.01);
const since = Date.now() - days * 864e5;

type Event = Record<string, any> & { at: string; kind: string };
const text = await Bun.file(`${home}/events.jsonl`).text().catch(() => "");
const events: Event[] = text.split("\n").flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; } // blank or half-written line
}).filter((e) => Date.parse(e.at) >= since);

const sum = (es: Event[], key: string) => es.reduce((n, e) => n + (Number(e[key]) || 0), 0);
const tokenRuns = (es: Event[]) => es.filter((e) => e.tokens_in != null).length;
// battery used: percent lost during runs that started on battery (1% steps, so short runs often show 0)
const drain = (es: Event[]) => es.filter((e) => e.power === "battery" && e.battery_start != null && e.battery_end != null)
  .reduce((n, e) => n + Math.max(0, e.battery_start - e.battery_end), 0);

const rows = Object.entries(Object.groupBy(events.filter((e) => e.kind !== "approval"), (e) => e.kind))
  .map(([kind, es = []]) => ({
    kind,
    runs: es.length,
    failed: es.filter((e) => (e.exit != null && e.exit !== 0) || e.state === "failed").length,
    minutes: (sum(es, "secs") / 60).toFixed(1),
    "cpu min": (sum(es, "cpu") / 60).toFixed(1),
    "tokens in/out": `${Math.round(sum(es, "tokens_in") / 1000)}k / ${Math.round(sum(es, "tokens_out") / 1000)}k`,
    // what one turn re-reads; a turn whose reply wasn't JSON logged no tokens, so it isn't counted
    "in per run": tokenRuns(es) ? `${Math.round(sum(es, "tokens_in") / tokenRuns(es) / 1000)}k` : "-",
    "cache hit": sum(es, "tokens_in") ? `${Math.round((100 * sum(es, "tokens_cached")) / sum(es, "tokens_in"))}%` : "-",
    "api $": sum(es, "cost_usd").toFixed(2),
    "battery %": drain(es),
    denials: sum(es, "denials"),
  }));

console.log(`Last ${days} day(s): ${events.length} events\n`);
if (rows.length) console.table(rows);
const approvals = events.filter((e) => e.kind === "approval");
if (approvals.length) console.log(`\nApprovals:\n${approvals.map((e) => `  ${e.at.slice(0, 16)}  ${e.text}`).join("\n")}`);

// The always-on parts: CPU they've used since they started.
for (const [label, pattern] of [["Interface server", "ui/server.ts"], ["Menu bar app", "Bot.app/Contents/MacOS/Bot"]]) {
  const pid = (await new Response(Bun.spawn(["pgrep", "-f", pattern]).stdout).text()).trim().split("\n")[0];
  const cpu = pid && (await new Response(Bun.spawn(["ps", "-o", "time=", "-p", pid]).stdout).text()).trim();
  console.log(`${label}: ${cpu ? `${cpu} CPU since it started` : "not running"}`);
}
