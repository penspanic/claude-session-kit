import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type SessionListItem } from "../api";
import { EmptyState, ErrorBox, Spinner } from "../components/Spinner";
import { decodeProjectDir, formatDuration, formatNumber, relTime, shortProject, shortSessionId } from "../lib/format";

const PAGE_SIZE = 50;

function labelSourceTag(source: NonNullable<SessionListItem["display_label_source"]>): string {
  switch (source) {
    case "custom_title":
      return "title";
    case "agent_name":
      return "agent";
    case "last_prompt":
      return "last prompt";
    default:
      return source;
  }
}

export function ProjectPage() {
  const [params] = useSearchParams();
  const projectDir = params.get("dir") ?? "";
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!projectDir) return;
    setItems(null);
    setError(null);
    api
      .sessions({ project: projectDir, limit: PAGE_SIZE, offset, group: "parent" })
      .then((res) => {
        setItems(res.sessions);
        setHasMore(res.sessions.length === PAGE_SIZE);
      })
      .catch((e) => setError((e as Error).message));
  }, [projectDir, offset]);

  if (!projectDir) return <ErrorBox message="Missing ?dir= query parameter." />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/" className="text-xs text-faint hover:text-dim">
            ← Home
          </Link>
          <h1 className="text-lg font-semibold mt-1">{shortProject(projectDir)}</h1>
          <div className="text-xs text-faint break-all">{decodeProjectDir(projectDir)}</div>
          <div className="text-[11px] text-faint mt-0.5">{projectDir}</div>
        </div>
        <div className="shrink-0 flex gap-2">
          <Link
            to={`/patterns?scope=project&dirs=${encodeURIComponent(projectDir)}`}
            className="px-3 py-1.5 rounded border border-border-strong text-xs hover:border-border-strong hover:bg-bg-elev"
          >
            Patterns →
          </Link>
          <Link
            to={`/analyze?project=${encodeURIComponent(projectDir)}`}
            className="px-3 py-1.5 rounded border border-border-strong text-xs hover:border-border-strong hover:bg-bg-elev"
          >
            Analyze →
          </Link>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {!items && !error && <Spinner />}
      {items && items.length === 0 && <EmptyState>No main sessions in this project.</EmptyState>}
      {items && items.length > 0 && <SessionTree items={items} />}

      {items && (offset > 0 || hasMore) && (
        <div className="flex items-center justify-between text-xs text-dim">
          <button
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            className="px-2 py-1 rounded border border-border disabled:opacity-30 hover:border-border-strong"
          >
            ← Newer
          </button>
          <span>offset {offset}</span>
          <button
            disabled={!hasMore}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            className="px-2 py-1 rounded border border-border disabled:opacity-30 hover:border-border-strong"
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
}

function SessionTree({ items }: { items: SessionListItem[] }) {
  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="grid grid-cols-[20px_140px_1fr_72px_56px_56px_64px] gap-3 px-3 py-2 text-[11px] uppercase tracking-wide text-faint border-b border-border bg-bg-elev/60">
        <span></span>
        <span>Started</span>
        <span>Summary / id</span>
        <span className="text-right">Duration</span>
        <span className="text-right">Msgs</span>
        <span className="text-right">Tools</span>
        <span className="text-right">Model</span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((s) => (
          <SessionTreeNode key={`${s.host_id}::${s.source_key}`} session={s} />
        ))}
      </ul>
    </div>
  );
}

function SessionTreeNode({ session }: { session: SessionListItem }) {
  const children = session.children ?? [];
  const [open, setOpen] = useState(false);
  const hasChildren = children.length > 0;

  return (
    <li>
      <Row session={session} indent={0} childBadge={hasChildren && !open ? children.length : null}>
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-dim hover:text-text text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-bg-sunk"
            title={open ? `Collapse ${children.length} subagent(s)` : `Expand ${children.length} subagent(s)`}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="text-faint text-xs w-5 h-5 flex items-center justify-center">·</span>
        )}
      </Row>
      {hasChildren && open && (
        <ul className="bg-bg/40">
          {children.map((c) => (
            <li key={`${c.host_id}::${c.source_key}`} className="border-t border-border">
              <Row session={c} indent={1}>
                <span className="text-faint text-xs w-5 h-5 flex items-center justify-center">└</span>
              </Row>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Row({
  session: s,
  indent,
  children,
  childBadge,
}: {
  session: SessionListItem;
  indent: number;
  children: React.ReactNode;
  childBadge?: number | null;
}) {
  return (
    <Link
      to={`/s?key=${encodeURIComponent(s.source_key)}&host=${encodeURIComponent(s.host_id)}`}
      className="grid grid-cols-[20px_140px_1fr_72px_56px_56px_64px] gap-3 px-3 py-2 text-sm hover:bg-bg-elev/80 items-center"
      style={indent > 0 ? { paddingLeft: `${12 + indent * 20}px` } : undefined}
    >
      {children}
      <span className="text-xs text-dim tabular-nums">
        {relTime(s.started_at ?? s.file_mtime)}
      </span>
      <span className="min-w-0">
        {s.display_label ? (
          <span className="block truncate text-text">{s.display_label}</span>
        ) : (
          <span className="block truncate text-faint italic">untitled session</span>
        )}
        <span className="block text-[11px] text-faint font-mono flex items-center gap-1 flex-wrap">
          <span>{shortSessionId(s.session_id)}</span>
          {s.display_label_source && s.display_label_source !== "summary" && (
            <span
              className="px-1 rounded bg-bg-sunk/80 text-dim text-[10px] not-italic"
              title={`Label source: ${s.display_label_source}`}
            >
              {labelSourceTag(s.display_label_source)}
            </span>
          )}
          {s.kind === "subagent" && (
            <span className="px-1 rounded bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 text-[10px]">subagent</span>
          )}
          {childBadge && childBadge > 0 && (
            <span className="px-1 rounded bg-bg-sunk text-dim text-[10px]">
              +{childBadge} subagent{childBadge === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </span>
      <span className="text-right text-xs text-dim tabular-nums">
        {formatDuration(s.duration_ms)}
      </span>
      <span className="text-right text-xs text-dim tabular-nums">
        {formatNumber(s.message_count)}
      </span>
      <span className="text-right text-xs text-dim tabular-nums">
        {formatNumber(s.tool_use_count)}
      </span>
      <span className="text-right text-[11px] text-dim truncate" title={s.model ?? ""}>
        {s.model ? s.model.replace(/^claude-/, "").replace(/-\d{8}$/, "") : "—"}
      </span>
    </Link>
  );
}
