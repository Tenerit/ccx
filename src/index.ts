#!/usr/bin/env node
import { collect, projectsDir } from "./parse.js";
import { loadPricing } from "./pricing.js";
import { buildCost, printCost } from "./cost.js";
import { buildWaste, printWaste } from "./waste.js";
import { bold, cyan, dim } from "./format.js";

interface Args {
  cmd: string;
  json: boolean;
  days?: number;
  project?: string;
  pricing?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? "help", json: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") a.json = true;
    else if (arg === "--days") a.days = Number(argv[++i]);
    else if (arg === "--project" || arg === "-p") a.project = argv[++i];
    else if (arg === "--pricing") a.pricing = argv[++i];
    else if (arg === "--help" || arg === "-h") a.cmd = "help";
  }
  return a;
}

const HELP = `${bold(cyan("ccx"))} — Claude Code X-Ray
Cross-session cost & token-waste analytics from your local Claude Code logs.
Reads ${dim("~/.claude/projects/**/*.jsonl")} only. Nothing leaves your machine.

${bold("Usage")}
  ccx cost            What you spent: per project, per day, top sessions
  ccx waste           Token waste: dup reads, fat tool dumps, cache churn, thinking
  ccx help            This message

${bold("Options")}
  --days <n>          Only sessions active in the last <n> days
  --project <name>    Filter to projects whose name contains <name>  (alias: -p)
  --json              Machine-readable output (pipe into jq, a statusline, etc.)
  --pricing <file>    Use a custom pricing.json (defaults to the bundled table)

${bold("Examples")}
  ccx cost
  ccx cost --days 7 --project myrepo
  ccx waste --json | jq '.fatDumps[0]'
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.cmd === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (args.cmd !== "cost" && args.cmd !== "waste") {
    process.stderr.write(`unknown command: ${args.cmd}\n\n${HELP}`);
    process.exit(2);
  }

  const pricing = loadPricing(args.pricing);
  const sinceMs = args.days ? Date.now() - args.days * 86_400_000 : undefined;
  const stats = await collect(pricing, { projectFilter: args.project, sinceMs });

  if (!stats.length) {
    if (args.json) {
      process.stdout.write("{}\n");
    } else {
      process.stderr.write(
        `No sessions found under ${projectsDir()}.\n` +
          `Set CCX_PROJECTS_DIR if your logs live elsewhere.\n`,
      );
    }
    return;
  }

  if (args.cmd === "cost") {
    const report = buildCost(stats);
    process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : printCost(report) + "\n");
  } else {
    const report = buildWaste(stats);
    process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : printWaste(report) + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`ccx: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
