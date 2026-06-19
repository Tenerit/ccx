import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { PricingTable, SessionStat, Usage } from "./types.js";
import { priceFor, usageCost } from "./pricing.js";

export function projectsDir(): string {
  // Override for tests / non-standard installs.
  if (process.env.CCX_PROJECTS_DIR) return process.env.CCX_PROJECTS_DIR;
  return join(homedir(), ".claude", "projects");
}

// Claude Code encodes the cwd into the project dir name, e.g.
// "C--Users-foo-Desktop-myrepo". Show the trailing segment — close enough
// to the repo name without trying to perfectly reverse the encoding.
export function prettyProject(encoded: string): string {
  const parts = encoded.split("-").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : encoded;
}

// List every {project, sessionFile} pair under the projects directory.
export async function listSessions(
  root: string,
): Promise<{ project: string; file: string }[]> {
  const out: { project: string; file: string }[] = [];
  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    return out;
  }
  for (const project of projects) {
    let files: string[];
    try {
      files = await readdir(join(root, project));
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith(".jsonl")) out.push({ project, file: join(root, project, f) });
    }
  }
  return out;
}

function tsToMs(ts: unknown): number {
  if (typeof ts !== "string") return 0;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? 0 : ms;
}

function blockChars(block: any): number {
  const c = block?.content;
  if (typeof c === "string") return c.length;
  if (Array.isArray(c)) {
    return c.reduce(
      (n: number, b: any) => n + (typeof b?.text === "string" ? b.text.length : 0),
      0,
    );
  }
  return 0;
}

// Did this usage block actually bill any tokens? Used to avoid warning about an
// unknown model on empty/heartbeat messages.
function hadTokens(u: Usage): boolean {
  return (
    (u.input_tokens ?? 0) +
      (u.output_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
      (u.cache_creation?.ephemeral_1h_input_tokens ?? 0) >
    0
  );
}

// Parse one .jsonl session into an aggregated SessionStat.
export async function parseSession(
  project: string,
  file: string,
  pricing: PricingTable,
): Promise<SessionStat> {
  const stat: SessionStat = {
    sessionId: file.split(/[\\/]/).pop()!.replace(/\.jsonl$/, ""),
    project,
    file,
    firstTs: 0,
    lastTs: 0,
    models: new Set(),
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheWriteFlat: 0,
    cacheRead: 0,
    cost: 0,
    reads: [],
    fatDumps: [],
    thinkingChars: 0,
    unknownModels: new Set(),
  };

  // tool_use id → tool name, so a tool_result can name the tool that produced it.
  const toolNames = new Map<string, string>();

  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // tolerate a truncated trailing line
    }

    const ts = tsToMs(row.timestamp);
    if (ts) {
      if (!stat.firstTs || ts < stat.firstTs) stat.firstTs = ts;
      if (ts > stat.lastTs) stat.lastTs = ts;
    }

    const msg = row.message;
    if (!msg) continue;

    // Assistant turn: usage + thinking + tool_use (Read) blocks.
    if (msg.role === "assistant") {
      if (typeof msg.model === "string") stat.models.add(msg.model);
      const usage: Usage | undefined = msg.usage;
      if (usage) {
        stat.inputTokens += usage.input_tokens ?? 0;
        stat.outputTokens += usage.output_tokens ?? 0;
        const w5 = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
        const w1 = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        stat.cacheWrite5m += w5;
        stat.cacheWrite1h += w1;
        if (w5 + w1 === 0) stat.cacheWriteFlat += usage.cache_creation_input_tokens ?? 0;
        stat.cacheRead += usage.cache_read_input_tokens ?? 0;
        const price = typeof msg.model === "string" ? priceFor(msg.model, pricing) : null;
        if (price) {
          stat.cost += usageCost(usage, price);
        } else if (typeof msg.model === "string" && hadTokens(usage)) {
          // No price match — record it so we can warn instead of silently
          // dropping this turn's cost (which would understate the total).
          stat.unknownModels.add(msg.model);
        }
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.type === "thinking" && typeof block.thinking === "string") {
            stat.thinkingChars += block.thinking.length;
          } else if (block?.type === "tool_use") {
            if (typeof block.id === "string" && typeof block.name === "string") {
              toolNames.set(block.id, block.name);
            }
            if (block.name === "Read") {
              const fp = block.input?.file_path;
              if (typeof fp === "string") stat.reads.push({ file: fp });
            }
          }
        }
      }
    }

    // User turn may carry tool_result blocks — measure the big ones.
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_result") {
          const chars = blockChars(block);
          if (chars > 0) {
            stat.fatDumps.push({
              // Name the tool that produced this output when we can resolve it.
              tool:
                (typeof block.tool_use_id === "string" &&
                  toolNames.get(block.tool_use_id)) ||
                "tool_result",
              chars,
              sessionId: stat.sessionId,
              project,
            });
          }
        }
      }
    }
  }

  return stat;
}

// Parse every session, optionally filtered by project substring and recency.
export async function collect(
  pricing: PricingTable,
  opts: { projectFilter?: string; sinceMs?: number } = {},
): Promise<SessionStat[]> {
  const root = projectsDir();
  const sessions = await listSessions(root);
  const stats: SessionStat[] = [];
  for (const { project, file } of sessions) {
    if (opts.projectFilter && !prettyProject(project).toLowerCase().includes(opts.projectFilter.toLowerCase())) {
      continue;
    }
    const stat = await parseSession(project, file, pricing);
    if (opts.sinceMs && stat.lastTs && stat.lastTs < opts.sinceMs) continue;
    stats.push(stat);
  }
  return stats;
}
