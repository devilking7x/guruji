/**
 * Landing page at `/` (i.e. https://devilking7x.github.io/guruji/).
 * Hero -> features -> how-it-works -> safety -> Prabhav (impact) -> footer.
 * One click ("Padhna shuru karo") reaches the app at `#/app`.
 */
import { useEffect, useState } from "react";
import { getImpact, type ImpactData } from "../api";
import { useLang } from "../i18n";
import { InstallButton, LangToggle } from "../components";

function Counter({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-center backdrop-blur">
      <p className="text-3xl font-extrabold text-accentlight tabular-nums">
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
      </p>
      <p className="text-xs text-white/50 mt-1">{label}</p>
    </div>
  );
}

function Prabhav() {
  const { t } = useLang();
  const [impact, setImpact] = useState<ImpactData | null>(null);

  useEffect(() => {
    let alive = true;
    getImpact()
      .then((d) => {
        if (alive) setImpact(d);
      })
      .catch(() => {
        // Backend unreachable or endpoint missing — graceful fallback below.
        if (alive) setImpact(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const hasData =
    impact !== null &&
    (impact.questions + impact.quizzes + impact.revisions > 0 ||
      !impact.learners.startsWith("0"));

  return (
    <section className="py-14">
      <h2 className="text-2xl font-extrabold tracking-tight text-center mb-2">
        {t.landing.impactTitle}
      </h2>
      <p className="text-sm text-white/50 text-center mb-8">{t.landing.impactSub}</p>
      {hasData && impact ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Counter value={impact.questions} label={t.landing.cQuestions} />
          <Counter value={impact.quizzes} label={t.landing.cQuizzes} />
          <Counter value={impact.revisions} label={t.landing.cRevisions} />
          <Counter value={impact.learners} label={t.landing.cLearners} />
        </div>
      ) : (
        <div className="rounded-2xl bg-white/5 border border-dashed border-accent/40 p-8 text-center max-w-xl mx-auto">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-white/80 font-semibold">{t.landing.impactSoonTitle}</p>
          <p className="text-sm text-white/50 mt-1">{t.landing.impactSoonDesc}</p>
        </div>
      )}
    </section>
  );
}

export default function Landing() {
  const { t } = useLang();

  return (
    <div className="min-h-dvh text-slate-100">
      <div className="max-w-4xl mx-auto px-4 pb-10">
        {/* top bar */}
        <header className="flex items-center justify-between py-4">
          <a href="#/" className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-accentlight to-accentdeep bg-clip-text text-transparent">
            {t.app.title}
          </a>
          <div className="flex items-center gap-2">
            <InstallButton />
            <a
              href="#/poster"
              className="text-xs font-bold text-white/60 hover:text-accentlight border border-white/10 hover:border-accent/50 rounded-full px-3 py-1.5 transition-colors"
            >
              {t.app.poster}
            </a>
            <LangToggle compact />
          </div>
        </header>

        {/* hero */}
        <section className="text-center py-14 md:py-20">
          <p className="inline-block text-xs font-semibold text-accentlight bg-accent/10 border border-accent/30 rounded-full px-4 py-1.5 mb-6">
            {t.landing.badge}
          </p>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight mb-5">
            <span className="bg-gradient-to-r from-accentlight via-accent to-accentdeep bg-clip-text text-transparent">
              {t.landing.heroTitle}
            </span>
          </h1>
          <p className="text-base md:text-lg text-white/60 max-w-2xl mx-auto mb-9 leading-relaxed">
            {t.landing.heroSub}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#/app"
              className="rounded-2xl bg-gradient-to-r from-accent to-accentdeep text-white text-lg font-bold px-10 py-4 hover:opacity-90 transition-opacity shadow-xl shadow-accent/25"
            >
              {t.landing.cta}
            </a>
            <a
              href="#/poster"
              className="rounded-2xl border border-accent/40 text-accentlight font-bold px-8 py-4 hover:border-accent transition-colors"
            >
              {t.landing.ctaSecondary}
            </a>
          </div>
        </section>

        {/* features */}
        <section className="py-10">
          <h2 className="text-2xl font-extrabold tracking-tight text-center mb-8">
            {t.landing.featuresTitle}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {t.landing.features.map((f) => (
              <div
                key={f.t}
                className="rounded-2xl bg-white/5 border border-white/10 p-5 backdrop-blur hover:border-accent/50 transition-colors"
              >
                <p className="font-bold text-white/90 mb-2">{f.t}</p>
                <p className="text-sm text-white/55 leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section className="py-10">
          <h2 className="text-2xl font-extrabold tracking-tight text-center mb-8">
            {t.landing.howTitle}
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            {t.landing.steps.map((s) => (
              <div
                key={s.t}
                className="rounded-2xl bg-gradient-to-b from-accent/15 to-transparent border border-accent/25 p-6 backdrop-blur"
              >
                <p className="text-lg font-extrabold text-accentlight mb-2">{s.t}</p>
                <p className="text-sm text-white/60 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* safety */}
        <section className="py-10">
          <div className="rounded-2xl bg-emerald-950/30 border border-emerald-500/25 p-6 md:p-8 backdrop-blur">
            <h2 className="text-xl font-extrabold tracking-tight mb-3">
              {t.landing.safetyTitle}
            </h2>
            <p className="text-sm text-white/65 leading-relaxed">{t.landing.safetyDesc}</p>
          </div>
        </section>

        <Prabhav />

        {/* final CTA */}
        <section className="text-center py-10">
          <a
            href="#/app"
            className="inline-block rounded-2xl bg-gradient-to-r from-accent to-accentdeep text-white text-lg font-bold px-10 py-4 hover:opacity-90 transition-opacity shadow-xl shadow-accent/25"
          >
            {t.landing.cta}
          </a>
        </section>

        <footer className="text-center text-xs text-white/30 pt-4 border-t border-white/10">
          <p>{t.landing.footerNote}</p>
          <p className="mt-1">{t.app.footer}</p>
        </footer>
      </div>
    </div>
  );
}
