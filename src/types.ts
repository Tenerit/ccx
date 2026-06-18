// Shapes we read out of ~/.claude/projects/**/*.jsonl.
// The log format is loosely typed and evolves; we read defensively and ignore
// anything we don't recognise.

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface PricingTable {
  models: Record<string, ModelPrice>;
}

// One Read tool call we saw, used by the duplicate-read detector.
export interface ReadCall {
  file: string;
}

// A tool_result block large enough that it bloated the context.
export interface FatDump {
  tool: string;
  chars: number;
  sessionId: string;
  project: string;
}

// Aggregated stats for a single session (.jsonl file).
export interface SessionStat {
  sessionId: string;
  project: string;
  file: string;
  firstTs: number; // epoch ms, 0 if unknown
  lastTs: number;
  models: Set<string>;
  // token totals across every assistant message in the session
  inputTokens: number;
  outputTokens: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheWriteFlat: number; // cache_creation_input_tokens when no 5m/1h split
  cacheRead: number;
  cost: number; // USD, cache-aware
  // waste signals
  reads: ReadCall[];
  fatDumps: FatDump[];
  thinkingChars: number;
}
