import { MarketList } from '../../../components/Views';
export default async function Page({ params }: { params: Promise<{ pos: string }> }) { const pos = (await params).pos.toUpperCase(); return <MarketList kind="position" position={pos} title={`Mercado ${pos}`} subtitle={`Movimiento de ADP y waivers para jugadores ${pos} del universo canónico.`} />; }
