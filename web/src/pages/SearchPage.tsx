import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type SearchPayload } from "../api";
import { ErrorBox, Spinner } from "../components/Spinner";
import { absTime, shortProject, shortSessionId } from "../lib/format";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const [input, setInput] = useState(initialQuery);
  const [data, setData] = useState<SearchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const q = params.get("q") ?? "";
    setInput(q);
    if (!q) {
      setData(null);
      return;
    }
    setPending(true);
    setError(null);
    api
      .search({ q })
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setPending(false));
  }, [params]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (q) setParams({ q });
    else setParams({});
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Search</h1>

      <form onSubmit={submit} className="flex gap-2">
        <input
          autoFocus
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='FTS5 syntax: e.g. "webgpu NEAR/3 shader"'
          className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded border border-neutral-700 bg-neutral-800 text-sm hover:bg-neutral-700"
        >
          Search
        </button>
      </form>

      {error && <ErrorBox message={error} />}
      {pending && <Spinner />}
      {data && !pending && (
        <div className="text-xs text-neutral-500">
          {data.count} hit(s) for <span className="text-neutral-300">{data.query}</span>
        </div>
      )}
      {data && data.hits.length > 0 && <HitList payload={data} />}
      {data && data.hits.length === 0 && !pending && (
        <div className="text-neutral-500 text-sm py-4">No matches.</div>
      )}
    </div>
  );
}

// FTS5 snippet wraps matches in literal `<mark>` / `</mark>` we set server-side.
// Everything else is raw user-message text and must be HTML-escaped before injection.
function safeSnippet(snippet: string): string {
  const MARK_OPEN = "\0OPEN\0";
  const MARK_CLOSE = "\0CLOSE\0";
  const masked = snippet.replaceAll("<mark>", MARK_OPEN).replaceAll("</mark>", MARK_CLOSE);
  const escaped = masked
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.replaceAll(MARK_OPEN, "<mark>").replaceAll(MARK_CLOSE, "</mark>");
}

function HitList({ payload }: { payload: SearchPayload }) {
  return (
    <ul className="space-y-2">
      {payload.hits.map((h) => (
        <li
          key={`${h.host_id}::${h.source_key}::${h.seq}`}
          className="rounded border border-neutral-800 bg-neutral-900/40 p-3"
        >
          <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-1">
            <Link
              to={`/p?dir=${encodeURIComponent(h.project_dir)}`}
              className="text-neutral-300 hover:text-neutral-100"
            >
              {shortProject(h.project_dir)}
            </Link>
            <span>{absTime(h.timestamp ?? h.started_at)}</span>
          </div>
          <Link
            to={`/s?key=${encodeURIComponent(h.source_key)}&host=${encodeURIComponent(h.host_id)}`}
            className="block"
          >
            <div
              className="text-sm text-neutral-200 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: safeSnippet(h.snippet) }}
            />
            <div className="text-[11px] text-neutral-500 mt-1 font-mono">
              #{h.seq} · {shortSessionId(h.session_id)}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
