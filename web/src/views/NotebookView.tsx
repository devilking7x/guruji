/**
 * 📓 "Notebook" — tutor chat answers the student bookmarked with 🔖.
 * GET /api/notebook -> list with search box + delete button.
 * Hindi/Marathi empty state when nothing is saved yet.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteNotebook, getNotebook, type NotebookItem } from "../api";
import { MessageContent } from "../chat/MessageContent";
import { useLang } from "../i18n";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotebookView() {
  const { t } = useLang();
  const [items, setItems] = useState<NotebookItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      setItems(await getNotebook());
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.notebook.loadErr);
      setItems([]);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    setDeleting(id);
    setErr("");
    try {
      await deleteNotebook(id);
      setItems((list) => (list ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.notebook.deleteErr);
    } finally {
      setDeleting(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items ?? [];
    if (!q) return list;
    return list.filter((i) => i.text.toLowerCase().includes(q));
  }, [items, query]);

  if (items === null) {
    return <p className="text-white/50 text-sm">{t.notebook.loading}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <h2 className="text-lg font-bold text-slate-100 tracking-tight mb-1">
          {t.notebook.title}
        </h2>
        <p className="text-sm text-white/60 mb-4">{t.notebook.desc}</p>
        {items.length > 0 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.notebook.searchPh}
            className="w-full rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-accent"
          />
        )}
      </div>

      {err && (
        <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
          {err}
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-8 text-center">
          <p className="text-3xl mb-2">📓</p>
          <p className="text-white/80 font-semibold">{t.notebook.emptyTitle}</p>
          <p className="text-sm text-white/50 mt-1">{t.notebook.emptyDesc}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center">
          <p className="text-white/70">{t.notebook.noResults}</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-white/40 px-1">
            {filtered.length} {t.notebook.count}
          </p>
          {filtered.map((n) => (
            <div
              key={n.id}
              className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-4 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-white/40 mb-1.5">
                  🔖 {fmtDateTime(n.createdAt)}
                </p>
                <div className="text-sm text-white/85 leading-relaxed">
                  <MessageContent text={n.text} rich />
                </div>
              </div>
              <button
                onClick={() => remove(n.id)}
                disabled={deleting === n.id}
                title={t.notebook.deleteTitle}
                className="shrink-0 text-white/40 hover:text-red-300 border border-white/10 hover:border-red-400/50 rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-40 transition-colors"
              >
                {deleting === n.id ? t.notebook.deleting : t.common.delete}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
