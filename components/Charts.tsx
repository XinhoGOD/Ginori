'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdpPoint, DefenseVsPosition, StatGame, StatLine, WaiverPoint } from '../lib/types';

const colors = ['#7ca8ff', '#47d7a0', '#f0b45e', '#f27c82', '#bd8cff'];
const formatTime = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value.slice(0, 10) : `${date.getMonth() + 1}/${date.getDate()}`; };
const tooltipStyle = { background: '#151b24', border: '1px solid #27303c', borderRadius: 7, color: '#edf2f7', fontSize: 11 };

export function AdpChart({ points }: { points: AdpPoint[] }) {
  const sources = [...new Set(points.map((point) => point.source))];
  const data = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    points.forEach((point) => { if (point.adp === null) return; const row = byTime.get(point.capturedAt) ?? { capturedAt: point.capturedAt }; row[point.source] = point.adp; byTime.set(point.capturedAt, row); });
    return [...byTime.values()].sort((a, b) => new Date(String(a.capturedAt)).getTime() - new Date(String(b.capturedAt)).getTime());
  }, [points]);
  if (!data.length) return <div className="chart-empty">No hay histórico ADP disponible para este jugador.</div>;
  return <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 5, right: 15, left: -15, bottom: 5 }}><CartesianGrid stroke="#202832" vertical={false} /><XAxis dataKey="capturedAt" tickFormatter={formatTime} stroke="#667488" tick={{ fontSize: 10 }} /><YAxis reversed stroke="#667488" tick={{ fontSize: 10 }} domain={['auto', 'auto']} /><Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => new Date(String(label)).toLocaleString()} /><Legend wrapperStyle={{ fontSize: 10 }} />{sources.map((source, index) => <Line key={source} type="monotone" dataKey={source} stroke={colors[index % colors.length]} dot={false} strokeWidth={2} connectNulls />)}</LineChart></ResponsiveContainer>;
}

export function WaiverChart({ points }: { points: WaiverPoint[] }) {
  const [window, setWindow] = useState(24);
  const data = points.filter((point) => point.lookbackHours === window).map((point) => ({ ...point, capturedAt: point.capturedAt })).sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  return <><div className="tabs" style={{ marginBottom: 12 }}>{[[24, '24H'], [72, '3D'], [168, '7D']].map(([value, label]) => <button className={`tab ${window === value ? 'active' : ''}`} key={value} onClick={() => setWindow(Number(value))}>{label}</button>)}</div>{data.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 5, right: 15, left: -15, bottom: 5 }}><CartesianGrid stroke="#202832" vertical={false} /><XAxis dataKey="capturedAt" tickFormatter={formatTime} stroke="#667488" tick={{ fontSize: 10 }} /><YAxis stroke="#667488" tick={{ fontSize: 10 }} /><Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => new Date(String(label)).toLocaleString()} /><Legend wrapperStyle={{ fontSize: 10 }} /><Line type="monotone" dataKey="adds" name="Adds reportados" stroke="#47d7a0" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="drops" name="Drops reportados" stroke="#f27c82" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="netAdds" name="Net adds reportados" stroke="#7ca8ff" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer> : <div className="chart-empty">Aún no hay snapshots de waivers para esta ventana.</div>}</>;
}

type TrendKey = keyof StatLine;

const trendOptions = (position: string | null) => {
  if (position === 'QB') return [
    ['passingYards', 'Yardas de pase', 'yds'],
    ['attempts', 'Intentos', 'int'],
    ['rushingYards', 'Yardas terrestres', 'yds'],
  ] as const;
  if (position === 'RB') return [
    ['rushAttempts', 'Acarreos', 'car'],
    ['rushingYards', 'Yardas terrestres', 'yds'],
    ['targets', 'Targets', 'tgt'],
    ['receivingYards', 'Yardas recibidas', 'yds'],
    ['touches', 'Toques', 'toques'],
  ] as const;
  return [
    ['targets', 'Targets', 'tgt'],
    ['receptions', 'Recepciones', 'rec'],
    ['receivingYards', 'Yardas recibidas', 'yds'],
    ['snapPctAvg', 'Snap %', '%'],
  ] as const;
};

export function StatTrendChart({ games, position }: { games: StatGame[]; position: string | null }) {
  const options = trendOptions(position);
  const [selected, setSelected] = useState<TrendKey>(options[0][0]);
  const [window, setWindow] = useState(5);
  const active = options.find(([key]) => key === selected) ?? options[0];
  const visibleGames = games.slice(-window);
  const data = useMemo(() => visibleGames.map((game) => ({
    label: `${String(game.season).slice(-2)} W${game.week}`,
    value: game[selected],
    date: game.date,
    team: game.team,
    opponent: game.opponent,
  })).filter((item): item is { label: string; value: number; date: string | null; team: string | null; opponent: string | null } => typeof item.value === 'number'), [visibleGames, selected]);
  if (!games.length || !data.length) return <div className="panel chart-empty">Sin partidos completos con datos para graficar.</div>;
  return <div className="panel stat-chart-panel">
    <div className="panel-head">
      <div><h3>Tendencia de uso</h3><span className="subtle">Últimos partidos disponibles · datos observados</span></div>
      <span className="chart-unit">{active[2]}</span>
    </div>
    <div className="tabs stat-chart-tabs">
      {options.map(([key, label]) => <button className={`tab ${selected === key ? 'active' : ''}`} key={key} onClick={() => setSelected(key)}>{label}</button>)}
    </div>
    <div className="tabs stat-window-tabs">
      {[5, 10, 20, 30].map((value) => <button className={`tab ${window === value ? 'active' : ''}`} disabled={games.length < value} key={value} onClick={() => setWindow(value)}>Últimos {value}</button>)}
    </div>
    <div className="stat-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 2 }}>
      <CartesianGrid stroke="#202832" vertical={false} />
      <XAxis dataKey="label" stroke="#667488" tick={{ fontSize: 10 }} />
      <YAxis stroke="#667488" tick={{ fontSize: 10 }} width={42} />
      <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => `Partido ${String(label)}`} formatter={(value) => [typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value, active[1]]} />
      <Line type="monotone" dataKey="value" name={active[1]} stroke="#47d7a0" strokeWidth={2.5} dot={{ r: 3, fill: '#47d7a0', strokeWidth: 0 }} activeDot={{ r: 5 }} />
    </LineChart></ResponsiveContainer></div>
  </div>;
}

const defenseKeys = (position: string) => position === 'QB'
  ? [['passingYardsAllowed', 'Yardas de pase'], ['passingTdsAllowed', 'TD de pase'], ['interceptionsAllowed', 'Intercepciones'], ['qbRushingYardsAllowed', 'Yardas terrestres QB']]
  : position === 'RB'
    ? [['carriesAllowed', 'Acarreos'], ['rushingYardsAllowed', 'Yardas terrestres'], ['targetsAllowed', 'Targets RB'], ['receivingYardsAllowed', 'Yardas recibidas RB']]
    : [['targetsAllowed', 'Targets'], ['receptionsAllowed', 'Recepciones'], ['receivingYardsAllowed', 'Yardas recibidas'], ['receivingTdsAllowed', 'TD recibidos']];

export function DefenseTrendChart({ defense }: { defense: DefenseVsPosition | null }) {
  if (!defense) return <div className="panel chart-empty">Sin datos defensivos observados para este matchup.</div>;
  const rows = defenseKeys(defense.position).map(([key, label]) => {
    const value = defense[key as keyof DefenseVsPosition];
    const rank = defense.ranks[key];
    return typeof value === 'number' ? { key, label, value, rank } : null;
  }).filter((row): row is { key: string; label: string; value: number; rank: number | null } => Boolean(row));
  if (!rows.length) return <div className="panel chart-empty">Sin métricas defensivas disponibles.</div>;
  return <div className="panel defense-chart-panel">
    <div className="panel-head"><div><h3>Perfil defensivo</h3><span className="subtle">{defense.opponent} vs {defense.position} · por juego</span></div><span className="chart-unit">{defense.games} juegos</span></div>
    <div className="defense-bars">{rows.map((row) => {
      const width = row.rank && defense.rankTotal > 1 ? Math.max(7, (row.rank / defense.rankTotal) * 100) : 0;
      return <div className="defense-bar-row" key={row.key}>
        <div className="defense-bar-label"><span>{row.label}</span><strong>{row.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></div>
        <div className="defense-bar-track"><span style={{ width: `${width}%` }} /></div>
        <small>{row.rank ? `${row.rank}/${defense.rankTotal}` : 'sin rank'}</small>
      </div>;
    })}</div>
    <div className="chart-footnote">1 = menos permisiva · {defense.rankTotal} equipos con datos · barra basada en ranking observado</div>
  </div>;
}
