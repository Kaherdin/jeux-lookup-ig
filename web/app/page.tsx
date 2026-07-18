import { ListScreen } from "@/components/list-screen";
import { DEFAULT_LIST_SLUG } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function Page() {
  return <ListScreen slug={DEFAULT_LIST_SLUG} />;
}
