import { estimateCost, normalizeModelId, priceFor } from "../pricing.js";
import type { LLMClient, LLMUsage, SummarizePrompt } from "../analyze.js";
import type { EnrichedSummary, SessionStore } from "../store/index.js";
import type { Finding, FindingKind, PatternScope } from "../types.js";

/** Default model for `csk patterns`. Sonnet over Haiku because the
 * cross-session synthesis benefits from reasoning quality more than latency. */
export const DEFAULT_PATTERNS_MODEL = "claude-sonnet-4-6";

/** Number of enriched summaries we'll send in one batch before chunking.
 * With ~800 input tokens per summary, 80 summaries ≈ 64k input tokens — well
 * within Sonnet's 200k window but large enough to see repetition. */
export const DEFAULT_PATTERNS_BATCH = 80;

/** Rough per-summary prompt contribution used for pre-flight estimates. */
const ESTIMATED_INPUT_TOKENS_PER_SUMMARY = 800;

/** Cross-session output is more variable than per-session summary; budget for
 * several findings worth of structured JSON. */
const ESTIMATED_OUTPUT_TOKENS = 2500;

const FIXED_OVERHEAD_TOKENS = 600;

const VALID_KINDS: FindingKind[] = [
  "repetition",
  "correction_pattern",
  "friction",
  "skill_gap",
  "codebase_smell",
  "documentation_gap",
  "test_coverage_gap",
  "api_friction",
];

export interface DetectPatternsOptions {
  scope: PatternScope;
  /** Maximum findings to request from the model. */
  maxFindings?: number;
}

export interface DetectPatternsResult {
  findings: Finding[];
  model: string;
  usage: LLMUsage;
  promptChars: number;
}

export async function detectPatterns(
  summaries: EnrichedSummary[],
  client: LLMClient,
  opts: DetectPatternsOptions,
): Promise<DetectPatternsResult> {
  if (summaries.length === 0) {
    throw new Error("detectPatterns requires at least one enriched summary");
  }
  const prompt = buildPrompt(summaries, opts.scope, opts.maxFindings ?? 12);
  const response = await client.summarize(prompt);
  const findings = parseFindings(response.text, summaries, opts.scope);
  return {
    findings,
    model: response.model,
    usage: response.usage,
    promptChars: prompt.user.length,
  };
}

const SHARED_OUTPUT_SPEC = `Respond with **JSON only** — no prose, no markdown fences. Single JSON object:

{
  "findings": [
    {
      "kind": "<one of the kinds listed below>",
      "title": "string — ≤80 chars, human-readable headline",
      "description": "string — 1-3 sentences explaining the pattern and why it matters",
      "cluster_key": "string — short slug for grouping; same slug = same pattern across runs",
      "suggested_remedy": "string — 1 sentence, concrete action (see remedy menu below)",
      "evidence": [
        {
          "source_key": "must match one of the provided sessions",
          "host_id": "must match that session's host_id",
          "quote": "verbatim excerpt from the session's friction_events / corrections / outcome"
        }
      ],
      "score": 0.0-1.0
    }
  ]
}

## Kind guide

**Assistant-behavior kinds** (remedy usually targets the ASSISTANT):
- "repetition": same intent recurs, suggesting a reusable skill or slash-command.
- "correction_pattern": user issues similar corrections across sessions — candidate CLAUDE.md rule.
- "friction": assistant retries/loops without progress in the same shape.
- "skill_gap": an intent consistently struggles — candidate new skill.

**Codebase kinds** (remedy targets the CODE, not the assistant — prefer these when the evidence implicates the code itself):
- "codebase_smell": the code has inconsistent patterns, duplicated constructs, or anti-patterns that keep tripping up whoever (human OR AI) touches it. Example: per-call JsonSerializer creation when a static instance exists; multiple paths doing the same normalization differently; dead code that gets re-discovered.
- "documentation_gap": an invariant or non-obvious rule is enforced by convention but undocumented. The assistant keeps violating it because nothing in the code says so. Example: "clear cache after world config change" with no doc near the cache API.
- "test_coverage_gap": a recurring bug shape has no regression test, so it keeps resurfacing. Example: cross-server handover bugs without integration tests for the specific failure modes.
- "api_friction": a module's API makes correct use require hidden side actions. Correct code looks incorrect until you know the trick. Example: cache that requires manual /clear-world-cache; serializer that errors unless you set X first.

## Remedy menu (pick what fits, don't default to the first)

1. **behavior_rule** — add a CLAUDE.md rule (only when the issue is genuinely about how the assistant should act, NOT when the underlying code is the cause).
2. **new_skill** — add a slash-command / skill for a repeated structured task.
3. **codebase_refactor** — consolidate duplicate logic, remove dead code, extract shared utility, replace per-call construction with a static instance, etc.
4. **codebase_docs** — add a module README, doc-comment near the relevant API, or inline comment documenting the invariant.
5. **api_change** — redesign the API surface so the correct path is the easy path (auto-invalidate cache, enforce via types, etc.).
6. **test_gap_fill** — add a regression test or integration test covering the failure shape.

## Important

When the evidence points at a SPECIFIC file, function, symbol, or module behavior, prefer codebase kinds + a codebase-oriented remedy over "add a CLAUDE.md rule telling the assistant to work around the code." A CLAUDE.md rule is a lossy workaround; fixing the underlying code removes the failure mode for everyone.

Examples of when to resist CLAUDE.md:
- Evidence says "created new JsonSerializer instead of reusing static" → \`codebase_smell\`, remedy: "consolidate to the static Serializer; delete Create() call sites."
- Evidence says "didn't clear cache after config change" → \`api_friction\`, remedy: "auto-invalidate the cache in the config setter."
- Evidence says "missed existing BaseSimulation.logger and added ILogger param" → \`documentation_gap\`, remedy: "add a doc-comment on BaseSimulation exposing the logger as the canonical one."`;

const PROJECT_SYSTEM_PROMPT = `You are a retrospective analyst for a developer working inside a **single logical project** (possibly spanning multiple worktree directories of the same repo). You've been given enriched session summaries from this project only. Your job is to surface repeating patterns that deserve a **project-scoped** fix: a rule in this project's CLAUDE.md, a project-specific slash-command, a project-specific skill.

Principles:
- **Project-internal only.** Do NOT generalize to "all work the user does." Findings should be meaningful only within this project's code, conventions, or current tasks.
- **Cite real sessions only.** Each finding must reference ≥2 of the provided sessions by (source_key, host_id). Never invent citations.
- **Be concrete.** Prefer observations with verbatim corrections or identical recurring intents over vague themes.
- **Remedies target project scope.** Prefer "add a rule to <this project>/CLAUDE.md" or "create a /<project>-specific slash command" over universal habits.
- **Silence is fine.** If no real pattern exists, return fewer findings or an empty array. Do not fabricate.

${SHARED_OUTPUT_SPEC}`;

const GLOBAL_SYSTEM_PROMPT = `You are a retrospective analyst for a developer who uses Claude Code **across many projects**. You've been given enriched session summaries sampled from multiple projects. Your job is to surface **universal patterns** — habits, workflow gaps, or assistant failure modes that recur regardless of project. These should drive changes to the developer's global \`~/.claude/CLAUDE.md\` or personal skills.

Principles:
- **Cross-project only.** Each finding MUST cite evidence from **≥2 distinct project_dirs**. A pattern that only shows up in one project is not global — drop it.
- **Universal habits, not project quirks.** "User always forgets to run tests before committing" is global. "User keeps tweaking the /serve command in Aethelgard" is not.
- **Cite real sessions only.** Each finding must reference ≥2 of the provided sessions by (source_key, host_id). Never invent citations.
- **Remedies target global scope.** Prefer "add a rule to ~/.claude/CLAUDE.md" or "create a personal skill" over project-local fixes.
- **Silence is fine.** If no real cross-project pattern exists, return fewer findings or an empty array. Do not fabricate.

${SHARED_OUTPUT_SPEC}`;

function buildPrompt(
  summaries: EnrichedSummary[],
  scope: PatternScope,
  maxFindings: number,
): SummarizePrompt {
  const lines: string[] = [];
  const distinctProjects = new Set(summaries.map((s) => s.project_dir));
  lines.push(
    `You have ${summaries.length} enriched session summaries from ${distinctProjects.size} project(s). Produce up to ${maxFindings} findings.`,
  );
  if (scope === "global") {
    lines.push(
      "Reminder: each finding MUST cite evidence from ≥2 DISTINCT project_dirs. Findings that fail this test will be discarded.",
    );
  }
  lines.push("");
  lines.push("## Sessions");
  for (const s of summaries) {
    lines.push(
      `### ${s.source_key}  (host=${s.host_id}, project=${s.project_dir}, started=${s.started_at ?? "?"})`,
    );
    if (s.summary.intent) lines.push(`intent: ${s.summary.intent}`);
    if (s.one_liner) lines.push(`one_liner: ${s.one_liner}`);
    if (s.summary.what_tried) lines.push(`what_tried: ${s.summary.what_tried}`);
    if (s.summary.outcome) lines.push(`outcome: ${s.summary.outcome}`);
    if (s.tags.length > 0) lines.push(`tags: ${s.tags.join(", ")}`);
    if (s.summary.friction_events && s.summary.friction_events.length > 0) {
      lines.push("friction_events:");
      for (const e of s.summary.friction_events) lines.push(`  - ${e}`);
    }
    if (s.summary.corrections && s.summary.corrections.length > 0) {
      lines.push("corrections:");
      for (const c of s.summary.corrections) {
        lines.push(`  - user: "${oneLine(c.user_quote)}"`);
        if (c.assistant_action) lines.push(`    assistant_had: ${oneLine(c.assistant_action)}`);
      }
    }
    lines.push("");
  }
  const system = scope === "global" ? GLOBAL_SYSTEM_PROMPT : PROJECT_SYSTEM_PROMPT;
  return { system, user: lines.join("\n") };
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseFindings(
  text: string,
  summaries: EnrichedSummary[],
  scope: PatternScope,
): Finding[] {
  const cleaned = stripCodeFences(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `LLM response was not valid JSON: ${(err as Error).message}\nResponse: ${text.slice(0, 400)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM findings response is not an object");
  }
  const root = parsed as Record<string, unknown>;
  const rawFindings = Array.isArray(root.findings) ? root.findings : [];
  // Build a lookup of valid (source_key, host_id) pairs so we can reject
  // hallucinated citations.
  const validKeys = new Set(
    summaries.map((s) => `${s.source_key}\u0000${s.host_id}`),
  );
  const projectByKey = new Map<string, string>();
  for (const s of summaries) {
    projectByKey.set(`${s.source_key}\u0000${s.host_id}`, s.project_dir);
  }

  const findings: Finding[] = [];
  for (const raw of rawFindings) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const kind = coerceKind(o.kind);
    if (!kind) continue;
    const title = stringOr(o.title, "").trim();
    const description = stringOr(o.description, "").trim();
    if (!title || !description) continue;

    const evidence = coerceEvidence(o.evidence, validKeys);
    // Spec requires ≥2 real citations per finding.
    if (evidence.length < 2) continue;

    // Global-scope findings MUST span at least 2 distinct project_dirs;
    // otherwise they're really project-specific and belong in a project run.
    if (scope === "global") {
      const projects = new Set<string>();
      for (const e of evidence) {
        const p = projectByKey.get(`${e.source_key}\u0000${e.host_id}`);
        if (p) projects.add(p);
      }
      if (projects.size < 2) continue;
    }

    const finding: Finding = {
      kind,
      title,
      description,
      evidence,
    };
    const clusterKey = stringOr(o.cluster_key, "").trim();
    if (clusterKey) finding.cluster_key = clusterKey;
    const remedy = stringOr(o.suggested_remedy, "").trim();
    if (remedy) finding.suggested_remedy = remedy;
    const score = typeof o.score === "number" && isFinite(o.score) ? clamp01(o.score) : undefined;
    if (score !== undefined) finding.score = score;
    findings.push(finding);
  }
  return findings;
}

function coerceKind(v: unknown): FindingKind | null {
  if (typeof v !== "string") return null;
  const k = v.trim() as FindingKind;
  return VALID_KINDS.includes(k) ? k : null;
}

function coerceEvidence(
  v: unknown,
  validKeys: Set<string>,
): Finding["evidence"] {
  if (!Array.isArray(v)) return [];
  const out: Finding["evidence"] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const source_key = stringOr(o.source_key, "").trim();
    const host_id = stringOr(o.host_id, "").trim();
    if (!source_key || !host_id) continue;
    const key = `${source_key}\u0000${host_id}`;
    if (!validKeys.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const quote = stringOr(o.quote, "").trim();
    out.push(quote ? { source_key, host_id, quote } : { source_key, host_id });
  }
  return out;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function stripCodeFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

export interface PatternsPlanFilter {
  host_id?: string;
  /** Project-mode: one or more project_dirs (e.g. worktrees of the same repo). */
  project_dirs?: string[];
  since?: string;
  limit?: number;
}

export interface PatternsPlan {
  model: string;
  model_known: boolean;
  summary_count: number;
  est_input_tokens: number;
  est_output_tokens: number;
  est_cost_usd: number | null;
  prices: { input_per_mtok: number; output_per_mtok: number } | null;
  notes: string;
  /** Source-key list in the order they'll be fed to the model. */
  candidates: Array<Pick<EnrichedSummary, "source_key" | "host_id" | "project_dir" | "session_id" | "started_at" | "one_liner">>;
}

/**
 * Pre-flight estimate for `csk patterns`. Mirrors planAnalyzeRun's shape so
 * the CLI and web surfaces can render costs the same way.
 */
export async function planPatternsRun(
  store: SessionStore,
  filter: PatternsPlanFilter,
  model: string = DEFAULT_PATTERNS_MODEL,
): Promise<PatternsPlan> {
  const summaries = await Promise.resolve(
    store.listEnrichedSummaries({
      host_id: filter.host_id,
      project_dirs: filter.project_dirs,
      since: filter.since,
      limit: filter.limit ?? DEFAULT_PATTERNS_BATCH,
    }),
  );

  const estInput =
    FIXED_OVERHEAD_TOKENS + summaries.length * ESTIMATED_INPUT_TOKENS_PER_SUMMARY;
  const estOutput = ESTIMATED_OUTPUT_TOKENS;
  const normalizedModel = normalizeModelId(model);
  const price = priceFor(model);
  const estCost = estimateCost(estInput, estOutput, model);

  return {
    model: normalizedModel,
    model_known: price !== null,
    summary_count: summaries.length,
    est_input_tokens: estInput,
    est_output_tokens: estOutput,
    est_cost_usd: estCost,
    prices: price,
    notes: `Estimate uses ~${ESTIMATED_INPUT_TOKENS_PER_SUMMARY} input tokens/summary + ${FIXED_OVERHEAD_TOKENS} overhead, ${ESTIMATED_OUTPUT_TOKENS} output tokens total. Actual usage varies with summary size and findings count.`,
    candidates: summaries.map((s) => ({
      source_key: s.source_key,
      host_id: s.host_id,
      project_dir: s.project_dir,
      session_id: s.session_id,
      started_at: s.started_at,
      one_liner: s.one_liner,
    })),
  };
}
