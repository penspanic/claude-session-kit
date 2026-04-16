import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type SessionDetailPayload } from "../api";
import { ErrorBox, Spinner } from "../components/Spinner";
import {
  absTime,
  decodeProjectDir,
  formatDuration,
  formatNumber,
  shortProject,
} from "../lib/format";

export function SessionPage() {
  const [params] = useSearchParams();
  const sourceKey = params.get("key") ?? "";
  const [data, setData] = useState<SessionDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceKey) return;
    setData(null);
    setError(null);
    api.session(sourceKey).then(setData).catch((e) => setError((e as Error).message));
  }, [sourceKey]);

  if (!sourceKey) return <ErrorBox message="Missing ?key= query parameter." />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;
  if (!data.found || !data.session) {
    return <ErrorBox message={data.reason ?? "Session not found."} />;
  }

  const s = data.session;
  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/p?dir=${encodeURIComponent(s.project_dir)}`}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          ← {shortProject(s.project_dir)}
        </Link>
        <h1 className="text-lg font-semibold mt-1 break-words">
          {s.display_label ?? <span className="italic text-neutral-500">untitled session</span>}
        </h1>
        {s.display_label_source && s.display_label_source !== "summary" && (
          <div className="mt-1 text-[11px] text-neutral-500">
            label from <span className="text-neutral-300">{s.display_label_source.replace("_", " ")}</span>
            {" — "}no LLM summary yet (run <code className="text-neutral-300">csk analyze</code>)
          </div>
        )}
        <div className="text-xs text-neutral-500 break-all font-mono mt-1">{s.source_key}</div>
        {s.kind === "subagent" && (
          <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 text-[10px]">
            subagent of {s.parent_session_id}
          </span>
        )}
      </div>

      {(s.custom_title || s.agent_name || s.last_prompt) && (
        <section>
          <SectionHead>From session log</SectionHead>
          <div className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-3 text-sm">
            {s.custom_title && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">Custom title</div>
                <div className="text-neutral-100">{s.custom_title}</div>
              </div>
            )}
            {s.agent_name && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">Agent name</div>
                <div className="font-mono text-neutral-100">{s.agent_name}</div>
              </div>
            )}
            {s.last_prompt && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">Last prompt (resume hint)</div>
                <div className="text-neutral-200 whitespace-pre-wrap">{s.last_prompt}</div>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <SectionHead>Metadata</SectionHead>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Meta label="Started" value={absTime(s.started_at)} />
          <Meta label="Ended" value={absTime(s.ended_at)} />
          <Meta label="Duration" value={formatDuration(s.duration_ms)} />
          <Meta label="Model" value={s.model ?? "—"} mono />
          <Meta label="Messages" value={formatNumber(s.message_count)} />
          <Meta label="User msgs" value={formatNumber(s.user_message_count)} />
          <Meta label="Tool calls" value={formatNumber(s.tool_use_count)} />
          <Meta
            label="Tokens (in/out)"
            value={`${formatNumber(s.input_tokens)} / ${formatNumber(s.output_tokens)}`}
          />
          <Meta label="Project" value={decodeProjectDir(s.project_dir)} />
          <Meta label="Host" value={s.host_id} mono />
        </div>
      </section>

      {s.tool_names && s.tool_names.length > 0 && (
        <section>
          <SectionHead>Tools used</SectionHead>
          <ToolChips tools={s.tool_names} />
        </section>
      )}

      {data.summary && (
        <section>
          <SectionHead>Summary</SectionHead>
          <SummaryBlock summary={data.summary} />
        </section>
      )}

      <section>
        <SectionHead>
          User messages
          <span className="text-xs font-normal text-neutral-500 ml-2">
            {data.user_messages?.length ?? 0}
          </span>
        </SectionHead>
        <UserMessageList messages={data.user_messages ?? []} />
      </section>
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-neutral-200 mb-2 uppercase tracking-wide">{children}</h2>;
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-0.5 text-sm truncate ${mono ? "font-mono text-neutral-300" : "text-neutral-100"}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function ToolChips({ tools }: { tools: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((t) => (
        <span key={t} className="px-2 py-0.5 text-xs rounded border border-neutral-700 bg-neutral-900 text-neutral-200">
          {t}
        </span>
      ))}
    </div>
  );
}

function SummaryBlock({
  summary,
}: {
  summary: NonNullable<SessionDetailPayload["summary"]>;
}) {
  const body = summary.summary;
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-3 text-sm">
      <Field label="What was tried" value={body.what_tried} />
      <Field label="Outcome" value={body.outcome} />
      {body.notable.length > 0 && (
        <ListField label="Notable" items={body.notable} />
      )}
      {body.blog_hooks.length > 0 && (
        <ListField label="Blog hooks" items={body.blog_hooks} />
      )}
      {summary.tags.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">Tags</div>
          <div className="flex flex-wrap gap-1.5">
            {summary.tags.map((t) => (
              <span key={t} className="px-1.5 py-0.5 text-[11px] rounded bg-neutral-800 text-neutral-300">
                #{t}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="text-[11px] text-neutral-500 pt-1 border-t border-neutral-800">
        Generated by {summary.model} on {absTime(summary.generated_at)}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">{label}</div>
      <div className="text-neutral-200 whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">{label}</div>
      <ul className="list-disc pl-5 space-y-0.5 text-neutral-200">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function UserMessageList({
  messages,
}: {
  messages: Array<{ seq: number; timestamp: string | null; content: string }>;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (seq: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  const previewLen = 240;

  const sorted = useMemo(() => [...messages].sort((a, b) => a.seq - b.seq), [messages]);

  if (sorted.length === 0) {
    return <div className="text-neutral-500 text-sm">No user messages indexed.</div>;
  }

  return (
    <ol className="space-y-2">
      {sorted.map((m) => {
        const isOpen = expanded.has(m.seq);
        const long = m.content.length > previewLen;
        const display = isOpen || !long ? m.content : `${m.content.slice(0, previewLen).trimEnd()}…`;
        return (
          <li key={m.seq} className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1">
              <span>
                #{m.seq} · {absTime(m.timestamp)}
              </span>
              {long && (
                <button
                  onClick={() => toggle(m.seq)}
                  className="text-neutral-400 hover:text-neutral-200"
                >
                  {isOpen ? "collapse" : "expand"}
                </button>
              )}
            </div>
            <div className="text-sm text-neutral-200 whitespace-pre-wrap break-words">{display}</div>
          </li>
        );
      })}
    </ol>
  );
}
