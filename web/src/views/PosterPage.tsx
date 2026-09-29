/**
 * Classroom poster at `#/poster` — printable HTML with an OFFLINE QR code
 * (SVG generated at build time by web/scripts/make-qr.mjs, inlined below).
 * No external API at runtime. Print CSS keeps it ink-friendly.
 */
import { POSTER_QR_SVG } from "../poster-qr";
import { useLang } from "../i18n";
import { LangToggle } from "../components";

export default function PosterPage() {
  const { t } = useLang();

  return (
    <div className="min-h-dvh text-slate-100">
      <div className="max-w-2xl mx-auto px-4 pb-10">
        <div className="no-print flex items-center justify-between py-4">
          <a
            href="#/"
            className="text-sm font-bold text-white/60 hover:text-accentlight transition-colors"
          >
            {t.poster.back}
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white text-sm font-bold px-5 py-2 hover:opacity-90 transition-opacity"
            >
              {t.poster.print}
            </button>
            <LangToggle compact />
          </div>
        </div>

        <div className="poster-sheet rounded-3xl bg-white/5 border border-accent/30 p-8 md:p-12 text-center shadow-2xl shadow-accent/10">
          <p className="text-5xl md:text-6xl font-extrabold tracking-tight mb-3 bg-gradient-to-r from-accentlight to-accentdeep bg-clip-text text-transparent">
            {t.poster.title}
          </p>
          <p className="text-sm md:text-base text-white/60 mb-8">{t.poster.subtitle}</p>

          <div
            className="inline-block bg-white rounded-3xl p-4 shadow-xl mb-8"
            role="img"
            aria-label="Guruji QR code"
            dangerouslySetInnerHTML={{ __html: POSTER_QR_SVG }}
          />

          <div className="grid gap-3 text-left mb-8">
            {t.poster.steps.map((s) => (
              <div
                key={s.t}
                className="rounded-2xl bg-white/5 border border-white/10 px-5 py-4"
              >
                <p className="font-extrabold text-accentlight mb-1">{s.t}</p>
                <p className="text-sm text-white/65">{s.d}</p>
              </div>
            ))}
          </div>

          <p className="text-sm font-semibold text-white/75 bg-accent/10 border border-accent/30 rounded-2xl px-5 py-4">
            {t.poster.scanNote}
          </p>
        </div>

        <p className="no-print text-center text-xs text-white/30 mt-6">
          https://devilking7x.github.io/guruji/
        </p>
      </div>
    </div>
  );
}
