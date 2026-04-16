import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface SessionDetails {
  started_at: string | null;
  ended_at: string | null;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_use_count: number;
  tool_names: string[];
  model: string | null;
  cwd: string | null;
  git_branch: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  parse_error_count: number;
}

export interface ParsedUserMessage {
  seq: number;
  timestamp: string | null;
  content: string;
}

export interface ParsedSession {
  details: SessionDetails;
  userMessages: ParsedUserMessage[];
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface RawBlock {
  type?: string;
  name?: string;
  text?: string;
}

interface RawMessage {
  role?: string;
  model?: string;
  content?: string | RawBlock[];
  usage?: RawUsage;
}

interface RawLine {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: RawMessage;
}

/**
 * Stream-parse a Claude Code session JSONL file.
 *
 * Returns both aggregate metadata and the list of user-message contents
 * (ready for FTS indexing). Read-only — never touches the DB or blob store.
 * Malformed lines are counted in `parse_error_count` but do not abort.
 */
export async function parseSessionFile(path: string): Promise<ParsedSession> {
  const details: SessionDetails = {
    started_at: null,
    ended_at: null,
    message_count: 0,
    user_message_count: 0,
    assistant_message_count: 0,
    tool_use_count: 0,
    tool_names: [],
    model: null,
    cwd: null,
    git_branch: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    parse_error_count: 0,
  };
  const userMessages: ParsedUserMessage[] = [];

  const toolNames = new Set<string>();
  const modelCounts = new Map<string, number>();

  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    let obj: RawLine;
    try {
      obj = JSON.parse(line) as RawLine;
    } catch {
      details.parse_error_count += 1;
      continue;
    }

    const ts = obj.timestamp;
    if (typeof ts === "string") {
      if (!details.started_at || ts < details.started_at) details.started_at = ts;
      if (!details.ended_at || ts > details.ended_at) details.ended_at = ts;
    }

    if (!details.cwd && typeof obj.cwd === "string") details.cwd = obj.cwd;
    if (!details.git_branch && typeof obj.gitBranch === "string") {
      details.git_branch = obj.gitBranch;
    }

    if (obj.type === "user") {
      details.message_count += 1;
      details.user_message_count += 1;

      const text = extractUserText(obj.message);
      if (text) {
        userMessages.push({
          seq: details.user_message_count,
          timestamp: typeof ts === "string" ? ts : null,
          content: text,
        });
      }
    } else if (obj.type === "assistant") {
      details.message_count += 1;
      details.assistant_message_count += 1;

      const msg = obj.message;
      if (msg?.model) {
        modelCounts.set(msg.model, (modelCounts.get(msg.model) ?? 0) + 1);
      }

      if (Array.isArray(msg?.content)) {
        for (const block of msg.content) {
          if (block?.type === "tool_use") {
            details.tool_use_count += 1;
            if (typeof block.name === "string") toolNames.add(block.name);
          }
        }
      }

      const usage = msg?.usage;
      if (usage) {
        details.input_tokens += usage.input_tokens ?? 0;
        details.output_tokens += usage.output_tokens ?? 0;
        details.cache_creation_tokens += usage.cache_creation_input_tokens ?? 0;
        details.cache_read_tokens += usage.cache_read_input_tokens ?? 0;
      }
    }
  }

  details.tool_names = [...toolNames].sort();
  details.model = pickMostCommon(modelCounts);
  return { details, userMessages };
}

function extractUserText(msg: RawMessage | undefined): string | null {
  if (!msg) return null;
  const content = msg.content;
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      // Index text blocks only. tool_result blocks are assistant→tool plumbing,
      // not user intent, and indexing them balloons the FTS table for no gain.
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        parts.push(block.text);
      }
    }
    return parts.length ? parts.join("\n").trim() || null : null;
  }
  return null;
}

function pickMostCommon(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let max = 0;
  for (const [key, n] of counts) {
    if (n > max) {
      max = n;
      best = key;
    }
  }
  return best;
}
