import { estimateCost, normalizeModelId, priceFor } from "./pricing.js";
import type { SessionStore } from "./store/index.js";
import type {
  SessionCorrection,
  SessionDetailsRecord,
  SessionRecord,
  SessionSummary,
  UserMessageRecord,
} from "./types.js";

/**
 * Schema version of the summary prompt. Bumped whenever the prompt gains
 * fields that downstream features (e.g. `csk patterns`) depend on. Persisted
 * on each summary row so those features can filter out older shapes cleanly.
 */
export const CURRENT_SIGNALS_VERSION = 1;

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  usage: LLMUsage;
}

export interface LLMClient {
  summarize(prompt: SummarizePrompt): Promise<LLMResponse>;
}

export interface SummarizePrompt {
  system: string;
  user: string;
}

export interface SummarizeInput {
  // Only these fields are read by the prompt builder; narrowing the type lets
  // callers pass either a full SessionRecord or an AnalyzeCandidate.
  session: Pick<
    SessionRecord,
    "source_key" | "host_id" | "project_dir" | "kind" | "session_id"
  >;
  details: SessionDetailsRecord | null;
  userMessages: UserMessageRecord[];
}

export interface SummarizeResult {
  summary: SessionSummary;
  model: string;
  usage: LLMUsage;
  promptChars: number;
}

/** Default character budget for the user-message excerpt in the prompt. */
const USER_MESSAGE_BUDGET_CHARS = 20_000;

/** Avg chars per token. Anthropic's docs cite "~4 chars per token" for English. */
const CHARS_PER_TOKEN = 4;

/**
 * Output tokens vary, but the structured-JSON summary lands around here in
 * practice. Used only for the pre-flight estimate, not the actual API call
 * (which uses the model's max_tokens parameter).
 */
const ESTIMATED_OUTPUT_TOKENS_PER_CALL = 500;

/** Average user-message length used by the rough estimator. */
const ESTIMATED_USER_MESSAGE_CHARS = 500;

/** Approximate fixed prompt overhead (system prompt + metadata block). */
const ESTIMATED_PROMPT_OVERHEAD_CHARS = 1_500;

/** Default model for `csk analyze` and the dashboard's analyze trigger. */
export const DEFAULT_ANALYZE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Generate a structured summary for one session. Input building is read-only
 * and deterministic; actual LLM call is delegated to the injected client so
 * tests can supply a canned response.
 */
export async function summarizeSession(
  input: SummarizeInput,
  client: LLMClient,
): Promise<SummarizeResult> {
  const prompt = buildPrompt(input);
  const response = await client.summarize(prompt);
  const summary = parseSummary(response.text);
  return {
    summary,
    model: response.model,
    usage: response.usage,
    promptChars: prompt.user.length,
  };
}

const SYSTEM_PROMPT = `You analyze Claude Code sessions for a developer's personal retrospective.

Your job is to read session metadata and a sample of the user's messages, then produce a concise structured summary. You never invent details that are not present in the input. If a field has no signal, emit an empty string or empty array.

Respond with **JSON only** — no prose before or after, no markdown fences. The response must parse as a single JSON object with exactly these fields:

{
  "one_liner": "string — a single sentence, <=140 chars",
  "what_tried": "string — what the user set out to accomplish, 1-2 sentences",
  "outcome": "string — what actually happened, 1-2 sentences; note failures honestly",
  "notable": ["array of 0-3 short strings — surprising events, errors, dead-ends, refactor decisions"],
  "blog_hooks": ["array of 0-2 short strings — angles worth turning into blog posts; empty if nothing novel"],
  "tags": ["array of 2-5 short lowercase tokens — e.g. debugging, refactor, ideation, infra, ui, testing"],
  "intent": "string — normalized task intent in 2-6 lowercase words, e.g. 'react component refactor', 'sql migration debugging'; empty string if unclear",
  "friction_events": ["array of 0-5 short strings — observed retries, backtracks, redo-loops, failed-then-refailed tests, repeated re-reads of the same file. Describe what the assistant did, not the user's intent. Omit if session was smooth."],
  "corrections": [
    {
      "user_quote": "verbatim user sentence that redirects or corrects the assistant",
      "assistant_action": "one-line description of what the assistant had just done that the user was correcting"
    }
  ]
}

Rules for the new fields:
- "intent" must be normalized: no tooling names unless central, no proper nouns unless they are the subject. Prefer common phrasing so different sessions working on the same kind of task share the same string.
- "friction_events" is for observable assistant behavior, not vibes. "retried the same failing test three times with no new info" is good; "struggled" is not. Empty array if the session flowed normally.
- "corrections" quotes the user verbatim. Include only corrections that suggest a missing rule or skill — ignore cosmetic nitpicks. Empty array if none. Max 5.`;

function buildPrompt(input: SummarizeInput): SummarizePrompt {
  const { session, details, userMessages } = input;

  const lines: string[] = [];
  lines.push("## Session metadata");
  lines.push(`- project_dir: ${session.project_dir}`);
  lines.push(`- kind: ${session.kind}`);
  lines.push(`- session_id: ${session.session_id}`);
  if (details?.started_at) lines.push(`- started_at: ${details.started_at}`);
  if (details?.ended_at) lines.push(`- ended_at: ${details.ended_at}`);
  if (details?.model) lines.push(`- model: ${details.model}`);
  if (details?.git_branch) lines.push(`- git_branch: ${details.git_branch}`);
  if (details?.cwd) lines.push(`- cwd: ${details.cwd}`);
  lines.push(
    `- messages: ${details?.message_count ?? "?"} (user=${details?.user_message_count ?? "?"}, assistant=${details?.assistant_message_count ?? "?"})`,
  );
  lines.push(`- tool_use_count: ${details?.tool_use_count ?? 0}`);
  if (details?.tool_names?.length) lines.push(`- tools: ${details.tool_names.join(", ")}`);
  if (details) {
    lines.push(
      `- tokens: input=${details.input_tokens} output=${details.output_tokens} cache_read=${details.cache_read_tokens}`,
    );
  }

  lines.push("");
  lines.push("## User messages (chronological)");
  const excerpt = excerptMessages(userMessages, USER_MESSAGE_BUDGET_CHARS);
  for (const m of excerpt) {
    lines.push(`### seq ${m.seq}${m.timestamp ? ` @ ${m.timestamp}` : ""}`);
    lines.push(m.content);
    lines.push("");
  }
  if (excerpt.length < userMessages.length) {
    lines.push(
      `_…(${userMessages.length - excerpt.length} additional user messages truncated to fit prompt budget)_`,
    );
  }

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

/**
 * Select a subset of user messages that fits in `budget` characters.
 *
 * Always includes the first and last 5 messages (they anchor intent and
 * outcome), then fills from the head until budget is exhausted.
 */
function excerptMessages(
  messages: UserMessageRecord[],
  budget: number,
): UserMessageRecord[] {
  if (messages.length <= 10) return messages;

  const head = messages.slice(0, 5);
  const tail = messages.slice(-5);
  const middle = messages.slice(5, -5);

  const selected = [...head];
  let used = selected.reduce((sum, m) => sum + m.content.length, 0);
  used += tail.reduce((sum, m) => sum + m.content.length, 0);

  for (const m of middle) {
    if (used + m.content.length > budget) break;
    selected.push(m);
    used += m.content.length;
  }

  selected.push(...tail);
  return selected;
}

function parseSummary(text: string): SessionSummary {
  const cleaned = stripCodeFences(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `LLM response was not valid JSON: ${(err as Error).message}\nResponse: ${text.slice(0, 400)}`,
    );
  }
  return coerceSummary(parsed);
}

function stripCodeFences(text: string): string {
  // Accept responses wrapped in ```json ... ``` despite the prompt asking for
  // raw JSON. LLMs regress sometimes; be forgiving on the way in.
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

function coerceSummary(obj: unknown): SessionSummary {
  if (!obj || typeof obj !== "object") {
    throw new Error("LLM summary did not parse to an object");
  }
  const o = obj as Record<string, unknown>;
  const summary: SessionSummary = {
    one_liner: stringOr(o.one_liner, ""),
    what_tried: stringOr(o.what_tried, ""),
    outcome: stringOr(o.outcome, ""),
    notable: stringArray(o.notable),
    blog_hooks: stringArray(o.blog_hooks),
    tags: stringArray(o.tags),
  };
  const intent = stringOr(o.intent, "").trim();
  if (intent) summary.intent = intent;
  const friction = stringArray(o.friction_events);
  if (friction.length > 0) summary.friction_events = friction;
  const corrections = coerceCorrections(o.corrections);
  if (corrections.length > 0) summary.corrections = corrections;
  return summary;
}

function coerceCorrections(v: unknown): SessionCorrection[] {
  if (!Array.isArray(v)) return [];
  const out: SessionCorrection[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const quote = stringOr(obj.user_quote, "").trim();
    const action = stringOr(obj.assistant_action, "").trim();
    if (!quote) continue;
    out.push({ user_quote: quote, assistant_action: action });
  }
  return out;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export interface AnalyzePlanFilter {
  host_id?: string;
  project_dir?: string;
  since?: string;
  limit?: number;
}

export interface AnalyzeCandidate {
  source_key: string;
  host_id: string;
  session_id: string;
  project_dir: string;
  kind: import("./types.js").SessionKind;
  parent_session_id: string | null;
  started_at: string | null;
  user_message_count: number | null;
  /** Per-session estimated input tokens under the heuristic. */
  est_input_tokens: number;
  /** Best-effort label: LLM one_liner > custom_title > agent_name > last_prompt. */
  display_label: string | null;
  display_label_source: "summary" | "custom_title" | "agent_name" | "last_prompt" | null;
}

export interface AnalyzePlan {
  model: string;
  /** True if we have a price entry for the model and the cost number is real. */
  model_known: boolean;
  /** Estimated *prompt* input tokens summed across all candidates (rough heuristic). */
  est_input_tokens: number;
  est_output_tokens: number;
  /** USD. Null when the model price is unknown. */
  est_cost_usd: number | null;
  /** Number of candidate sessions. Run with the same set or a subset. */
  api_calls: number;
  candidates: AnalyzeCandidate[];
  /** Per-1M-token rates surfaced for the UI; null when unknown. */
  prices: { input_per_mtok: number; output_per_mtok: number } | null;
  /** Output tokens estimated per call (constant). */
  est_output_tokens_per_call: number;
  /**
   * Free-form rationale shown in UIs so users understand "추정치".
   * Lists the heuristic constants used.
   */
  notes: string;
}

/**
 * Pre-flight cost/scope estimate for a `csk analyze` run.
 *
 * Reads candidate sessions from the store and applies a coarse heuristic
 * (`min(20k chars, user_msg_count * 500) + 1.5k overhead, /4 chars-per-token`)
 * to avoid fetching every user-message body. Output token count is a fixed
 * per-call constant. The returned numbers are intended for *display* — the UI
 * must label them as estimates.
 */
export async function planAnalyzeRun(
  store: SessionStore,
  filter: AnalyzePlanFilter,
  model: string = DEFAULT_ANALYZE_MODEL,
): Promise<AnalyzePlan> {
  const sessions = await Promise.resolve(
    store.listUnanalyzedSessions({
      host_id: filter.host_id,
      project_dir: filter.project_dir,
      since: filter.since,
      limit: filter.limit ?? 25,
    }),
  );

  const candidates: AnalyzeCandidate[] = [];
  let estInputTokens = 0;
  for (const session of sessions) {
    const details = await Promise.resolve(store.getSessionDetails(session.source_key, session.host_id));
    const userMsgCount = details?.user_message_count ?? 0;
    const userMsgChars = Math.min(USER_MESSAGE_BUDGET_CHARS, userMsgCount * ESTIMATED_USER_MESSAGE_CHARS);
    const totalChars = userMsgChars + ESTIMATED_PROMPT_OVERHEAD_CHARS;
    const sessionEstIn = Math.ceil(totalChars / CHARS_PER_TOKEN);
    estInputTokens += sessionEstIn;

    const customTitle = details?.custom_title ?? null;
    const agentName = details?.agent_name ?? null;
    const lastPrompt = details?.last_prompt ?? null;
    let label: string | null = null;
    let labelSource: AnalyzeCandidate["display_label_source"] = null;
    if (customTitle) {
      label = customTitle;
      labelSource = "custom_title";
    } else if (agentName) {
      label = agentName;
      labelSource = "agent_name";
    } else if (lastPrompt) {
      label = lastPrompt;
      labelSource = "last_prompt";
    }

    candidates.push({
      source_key: session.source_key,
      host_id: session.host_id,
      session_id: session.session_id,
      project_dir: session.project_dir,
      kind: session.kind,
      parent_session_id: session.parent_session_id,
      started_at: details?.started_at ?? null,
      user_message_count: details?.user_message_count ?? null,
      est_input_tokens: sessionEstIn,
      display_label: label,
      display_label_source: labelSource,
    });
  }
  const estOutputTokens = candidates.length * ESTIMATED_OUTPUT_TOKENS_PER_CALL;

  const price = priceFor(model);
  const estCost = estimateCost(estInputTokens, estOutputTokens, model);

  return {
    model: normalizeModelId(model),
    model_known: price !== null,
    est_input_tokens: estInputTokens,
    est_output_tokens: estOutputTokens,
    est_cost_usd: estCost,
    api_calls: candidates.length,
    candidates,
    prices: price,
    est_output_tokens_per_call: ESTIMATED_OUTPUT_TOKENS_PER_CALL,
    notes: `Estimate uses ~${CHARS_PER_TOKEN} chars/token, capped at ${USER_MESSAGE_BUDGET_CHARS / 1000}k chars per session, +${ESTIMATED_PROMPT_OVERHEAD_CHARS} chars overhead, ${ESTIMATED_OUTPUT_TOKENS_PER_CALL} output tokens/call. Actual usage will vary.`,
  };
}
