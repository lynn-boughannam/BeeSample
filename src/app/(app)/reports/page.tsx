import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/dal";

// Reports has no landing page of its own — the first tab is the entry point.
export default async function ReportsIndex() {
  await requireAdmin();
  redirect("/reports/library");
}
