/**
 * Minimal hash router — `#/`, `#/app`, `#/app/<tab>`, `#/poster`.
 * No dependency needed: GitHub Pages serves /guruji/index.html for every
 * path, and everything after `#` is client-side. Deep links like
 * /guruji/#/app/quiz just work.
 */
import { useCallback, useEffect, useState } from "react";

export function getHashPath(): string {
  if (typeof window === "undefined") return "/";
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return "/";
  return h.startsWith("/") ? h : `/${h}`;
}

export function useHashRoute(): [string, (path: string) => void] {
  const [path, setPath] = useState<string>(getHashPath);

  useEffect(() => {
    const onChange = () => setPath(getHashPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((p: string) => {
    const next = p.startsWith("/") ? p : `/${p}`;
    if (getHashPath() === next) {
      setPath(next);
      return;
    }
    window.location.hash = `#${next}`;
  }, []);

  return [path, navigate];
}

/** Scroll to top whenever the hash route changes. */
export function useScrollTopOnRoute(path: string): void {
  useEffect(() => {
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* ignore */
    }
  }, [path]);
}
