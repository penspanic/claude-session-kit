export function Spinner({ label }: { label?: string }) {
  return <div className="text-faint text-sm py-4">{label ?? "Loading…"}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
      {message}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="text-faint text-sm py-8 text-center">{children}</div>;
}
