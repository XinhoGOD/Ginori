"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Player } from "../lib/types";

const searchCache = new Map<string, Player[]>();

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Player[]>([]);
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const cached = searchCache.get(term.toLowerCase());
    if (cached) {
      setResults(cached);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/players?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((body) => {
          const players = body.players ?? [];
          searchCache.set(term.toLowerCase(), players);
          setResults(players);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);
  const goTo = (id: string) => {
    setSearch("");
    setResults([]);
    router.push(`/player/${id}`);
  };
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">FM</span>
          <span>
            Fantasy Market Tracker
            <small>Inteligencia del mercado Fantasy NFL</small>
          </span>
        </Link>
        <nav className="nav">
          {[
            ["/rising", "Subiendo"],
            ["/waivers", "Waivers"],
            ["/hot", "Calientes"],
            ["/early", "Tempranas"],
            ["/divergences", "Divergencias"],
            ["/compare", "Comparar"],
            ["/data", "Salud de datos"],
          ].map(([href, label]) => (
            <Link
              className={pathname === href ? "active" : ""}
              key={href}
              href={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            aria-label="Buscar jugador NFL"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar jugador NFL..."
          />
          {results.length > 0 && (
            <div className="search-results">
              {results.map((player) => (
                <button
                  className="search-result"
                  key={player.id}
                  onClick={() => goTo(player.id)}
                >
                  <span>{player.name}</span>
                  <span>
                    {player.team ?? "Agente libre"} · {player.position ?? "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
