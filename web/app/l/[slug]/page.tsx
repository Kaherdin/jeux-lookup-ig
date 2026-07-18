import { ListScreen } from "@/components/list-screen";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ListScreen slug={slug} />;
}
