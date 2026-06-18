import type { SessionStat } from "./types.js";
import { prettyProject } from "./parse.js";
import { bold, cyan, dim, money, num, table } from "./format.js";

export interface CostReport {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  sessions: number;
  byProject: { project: string; cost: number; sessions: number }[];
  byDay: { day: string; cost: number }[];
  topSessions: { sessionId: string; project: string; cost: number }[];
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function buildCost(stats: SessionStat[]): CostReport {
  const proj = new Map<string, { cost: number; sessions: number }>();
  const day = new Map<string, number>();
  let totalCost = 0,
    totalInput = 0,
    totalOutput = 0,
    totalCacheRead = 0,
    totalCacheWrite = 0;

  for (const s of stats) {
    totalCost += s.cost;
    totalInput += s.inputTokens;
    totalOutput += s.outputTokens;
    totalCacheRead += s.cacheRead;
    totalCacheWrite += s.cacheWrite5m + s.cacheWrite1h + s.cacheWriteFlat;

    const p = prettyProject(s.project);
    const pe = proj.get(p) ?? { cost: 0, sessions: 0 };
    pe.cost += s.cost;
    pe.sessions += 1;
    proj.set(p, pe);

    if (s.lastTs) day.set(dayKey(s.lastTs), (day.get(dayKey(s.lastTs)) ?? 0) + s.cost);
  }

  return {
    totalCost,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    sessions: stats.length,
    byProject: [...proj.entries()]
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.cost - a.cost),
    byDay: [...day.entries()].map(([day, cost]) => ({ day, cost })).sort((a, b) => a.day.localeCompare(b.day)),
    topSessions: [...stats]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
      .map((s) => ({ sessionId: s.sessionId, project: prettyProject(s.project), cost: s.cost })),
  };
}

export function printCost(r: CostReport): string {
  const out: string[] = [];
  const cacheTotal = r.totalCacheRead + r.totalCacheWrite;
  const hitRate = cacheTotal ? (r.totalCacheRead / cacheTotal) * 100 : 0;

  out.push(bold(cyan("ccx cost")) + dim(`  ·  ${r.sessions} sessions`));
  out.push("");
  out.push(`  ${bold(money(r.totalCost))} total`);
  out.push(
    dim(
      `  in ${num(r.totalInput)} · out ${num(r.totalOutput)} · cache-read ${num(
        r.totalCacheRead,
      )} · cache-write ${num(r.totalCacheWrite)} · hit-rate ${hitRate.toFixed(0)}%`,
    ),
  );
  out.push("");

  out.push(bold("By project"));
  out.push(
    table(
      [{ header: "project" }, { header: "sessions", right: true }, { header: "cost", right: true }],
      r.byProject.map((p) => [p.project, num(p.sessions), money(p.cost)]),
    ),
  );
  out.push("");

  if (r.byDay.length) {
    out.push(bold("By day"));
    out.push(
      table(
        [{ header: "day" }, { header: "cost", right: true }],
        r.byDay.map((d) => [d.day, money(d.cost)]),
      ),
    );
    out.push("");
  }

  out.push(bold("Most expensive sessions"));
  out.push(
    table(
      [{ header: "session" }, { header: "project" }, { header: "cost", right: true }],
      r.topSessions.map((s) => [s.sessionId.slice(0, 8), s.project, money(s.cost)]),
    ),
  );
  return out.join("\n");
}
