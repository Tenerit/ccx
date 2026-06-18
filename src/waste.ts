import type { SessionStat } from "./types.js";
import { prettyProject } from "./parse.js";
import { bold, cyan, dim, num, table, yellow } from "./format.js";

export interface WasteReport {
  dupReads: { file: string; project: string; sessionId: string; count: number }[];
  fatDumps: { tool: string; project: string; sessionId: string; chars: number; estTokens: number }[];
  cacheChurn: {
    project: string;
    sessionId: string;
    write: number;
    read: number;
    ratio: number; // write / (write+read); high = unstable prefix
  }[];
  thinking: { project: string; sessionId: string; chars: number; estTokens: number }[];
}

const estTok = (chars: number) => Math.round(chars / 4);

export function buildWaste(stats: SessionStat[]): WasteReport {
  const dupReads: WasteReport["dupReads"] = [];
  for (const s of stats) {
    const counts = new Map<string, number>();
    for (const r of s.reads) counts.set(r.file, (counts.get(r.file) ?? 0) + 1);
    for (const [file, count] of counts) {
      if (count > 1) dupReads.push({ file, project: prettyProject(s.project), sessionId: s.sessionId, count });
    }
  }
  dupReads.sort((a, b) => b.count - a.count);

  const fatDumps: WasteReport["fatDumps"] = [];
  for (const s of stats) {
    for (const d of s.fatDumps) {
      fatDumps.push({
        tool: d.tool,
        project: prettyProject(s.project),
        sessionId: s.sessionId,
        chars: d.chars,
        estTokens: estTok(d.chars),
      });
    }
  }
  fatDumps.sort((a, b) => b.chars - a.chars);

  const cacheChurn: WasteReport["cacheChurn"] = stats
    .map((s) => {
      const write = s.cacheWrite5m + s.cacheWrite1h + s.cacheWriteFlat;
      const read = s.cacheRead;
      const total = write + read;
      return {
        project: prettyProject(s.project),
        sessionId: s.sessionId,
        write,
        read,
        ratio: total ? write / total : 0,
      };
    })
    // Only flag sessions with meaningful cache traffic and a bad ratio.
    .filter((c) => c.write + c.read > 50_000 && c.ratio > 0.4)
    .sort((a, b) => b.write - a.write);

  const thinking: WasteReport["thinking"] = stats
    .filter((s) => s.thinkingChars > 0)
    .map((s) => ({
      project: prettyProject(s.project),
      sessionId: s.sessionId,
      chars: s.thinkingChars,
      estTokens: estTok(s.thinkingChars),
    }))
    .sort((a, b) => b.chars - a.chars);

  return { dupReads, fatDumps, thinking, cacheChurn };
}

export function printWaste(r: WasteReport): string {
  const out: string[] = [];
  out.push(bold(cyan("ccx waste")) + dim("  ·  things that burned tokens you may not need to"));
  out.push("");

  out.push(bold("Duplicate file reads") + dim("  (same file Read 2+ times in one session)"));
  if (r.dupReads.length) {
    out.push(
      table(
        [{ header: "×", right: true }, { header: "file" }, { header: "project" }, { header: "session" }],
        r.dupReads.slice(0, 15).map((d) => [yellow(`${d.count}`), short(d.file), d.project, d.sessionId.slice(0, 8)]),
      ),
    );
  } else out.push(dim("  none"));
  out.push("");

  out.push(bold("Fattest tool outputs") + dim("  (biggest tool_results = context bloat)"));
  if (r.fatDumps.length) {
    out.push(
      table(
        [{ header: "~tokens", right: true }, { header: "tool" }, { header: "project" }, { header: "session" }],
        r.fatDumps.slice(0, 15).map((d) => [yellow(num(d.estTokens)), d.tool, d.project, d.sessionId.slice(0, 8)]),
      ),
    );
  } else out.push(dim("  none"));
  out.push("");

  out.push(bold("Cache churn") + dim("  (high write vs read = unstable prefix bleeding money)"));
  if (r.cacheChurn.length) {
    out.push(
      table(
        [
          { header: "write%", right: true },
          { header: "write", right: true },
          { header: "read", right: true },
          { header: "project" },
          { header: "session" },
        ],
        r.cacheChurn.slice(0, 15).map((c) => [
          yellow(`${(c.ratio * 100).toFixed(0)}%`),
          num(c.write),
          num(c.read),
          c.project,
          c.sessionId.slice(0, 8),
        ]),
      ),
    );
  } else out.push(dim("  none"));
  out.push("");

  out.push(bold("Thinking spend") + dim("  (estimated reasoning tokens per session)"));
  if (r.thinking.length) {
    out.push(
      table(
        [{ header: "~tokens", right: true }, { header: "project" }, { header: "session" }],
        r.thinking.slice(0, 10).map((t) => [num(t.estTokens), t.project, t.sessionId.slice(0, 8)]),
      ),
    );
  } else out.push(dim("  none"));
  return out.join("\n");
}

function short(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
}
