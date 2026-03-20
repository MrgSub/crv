import { EvalStudio } from "@/components/eval-studio";
import { getCatalog } from "@/lib/catalog";
import { pickDefaultSelections } from "@/lib/default-selections";

export default async function Page() {
  const catalog = await getCatalog();
  const initialSelections = pickDefaultSelections(catalog);

  return <EvalStudio catalog={catalog} initialSelections={initialSelections} />;
}
