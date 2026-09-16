"use client";

import { useState } from "react";

export function PlayerVisual({
  name,
  playerId,
  espnId,
  team,
  size = "small",
}: {
  name: string;
  playerId: string;
  espnId?: string | null;
  team?: string | null;
  size?: "small" | "hero";
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const sources = [
    `https://sleepercdn.com/content/nfl/players/${playerId}.jpg`,
    ...(espnId
      ? [`https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`]
      : []),
    ...(team
      ? [`https://a.espncdn.com/i/teamlogos/nfl/500/${team.toLowerCase()}.png`]
      : []),
  ];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className={`player-visual ${size}`} title={name}>
      {sourceIndex < sources.length ? (
        <img
          src={sources[sourceIndex]}
          alt={`Foto de ${name}`}
          onError={() => setSourceIndex((current) => current + 1)}
        />
      ) : (
        <span>{team ?? initials}</span>
      )}
    </div>
  );
}
