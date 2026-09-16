import { MarketList } from "../../components/Views";

export default function Page() {
  return (
    <MarketList
      kind="waivers"
      title="Mercado de waivers"
      subtitle="Explora los jugadores con más adds, más drops o net adds reportados por Sleeper. Los cambios de ventanas móviles son observaciones, no transacciones exactas."
    />
  );
}
