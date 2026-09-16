import { PlayerProfileView } from '../../../components/Views';
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <PlayerProfileView id={(await params).id} />; }
