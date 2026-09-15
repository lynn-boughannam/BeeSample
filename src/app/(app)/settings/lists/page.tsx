import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ManagedList, type ListItem } from "./managed-list";
import {
  createFunction,
  renameFunction,
  deleteFunction,
  createPhysicalForm,
  renamePhysicalForm,
  deletePhysicalForm,
  createSupplier,
  renameSupplier,
  deleteSupplier,
  createChemicalFamily,
  renameChemicalFamily,
  deleteChemicalFamily,
  createRegulatoryFunction,
  renameRegulatoryFunction,
  deleteRegulatoryFunction,
  createProject,
  renameProject,
  deleteProject,
} from "./actions";

// Counts how many samples reference each name, so the UI can show usage and block
// deletes that would orphan existing sample data. Grouping once per field beats a
// count query per row.
async function usageByName(
  field: "function" | "physicalForm" | "supplier" | "projectName"
) {
  const rows = await prisma.sample.groupBy({ by: [field], _count: { _all: true } });
  const map = new Map<string, number>();
  for (const row of rows) {
    const value = row[field];
    if (value) map.set(value, row._count._all);
  }
  return map;
}

// The compliance lists are consumed by ingredients rather than samples.
async function ingredientUsageByName(field: "chemicalFamily" | "regulatoryFunction") {
  const rows = await prisma.ingredientListEntry.groupBy({ by: [field], _count: { _all: true } });
  const map = new Map<string, number>();
  for (const row of rows) {
    const value = row[field];
    if (value) map.set(value, row._count._all);
  }
  return map;
}

export default async function ReferenceListsPage() {
  await requireAdmin();

  const [
    functions,
    physicalForms,
    suppliers,
    chemicalFamilies,
    regulatoryFunctions,
    projects,
    fnUsage,
    pfUsage,
    supUsage,
    cfUsage,
    rfUsage,
    projUsage,
  ] = await Promise.all([
    prisma.sampleFunction.findMany({ orderBy: { name: "asc" } }),
    prisma.physicalForm.findMany({ orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.chemicalFamily.findMany({ orderBy: { name: "asc" } }),
    prisma.regulatoryFunction.findMany({ orderBy: { name: "asc" } }),
    prisma.project.findMany({ orderBy: { name: "asc" } }),
    usageByName("function"),
    usageByName("physicalForm"),
    usageByName("supplier"),
    ingredientUsageByName("chemicalFamily"),
    ingredientUsageByName("regulatoryFunction"),
    usageByName("projectName"),
  ]);

  const withUsage = (
    rows: Array<{ id: string; name: string }>,
    usage: Map<string, number>
  ): ListItem[] => rows.map((r) => ({ id: r.id, name: r.name, inUse: usage.get(r.name) ?? 0 }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">Reference lists</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          The fixed value lists the Add Sample form draws on. Entries in use by existing
          samples can be renamed but not deleted.
        </p>
      </div>

      <ManagedList
        title="Functions"
        description="What the raw material does in a formulation — e.g. Humectant, Emulsifier."
        emptyMessage="No functions yet. Add the first one to populate the Add Sample dropdown."
        items={withUsage(functions, fnUsage)}
        createAction={createFunction}
        renameAction={renameFunction}
        deleteAction={deleteFunction}
      />

      <ManagedList
        title="Physical forms"
        description="The physical state a sample arrives in — e.g. Powder, Liquid, Flakes."
        emptyMessage="No physical forms yet. Add the first one to populate the Add Sample dropdown."
        items={withUsage(physicalForms, pfUsage)}
        createAction={createPhysicalForm}
        renameAction={renamePhysicalForm}
        deleteAction={deletePhysicalForm}
      />

      <ManagedList
        title="Suppliers"
        description="Companies raw materials are sourced from."
        emptyMessage="No suppliers yet. Add the first one to populate the Add Sample dropdown."
        items={withUsage(suppliers, supUsage)}
        createAction={createSupplier}
        renameAction={renameSupplier}
        deleteAction={deleteSupplier}
      />

      <ManagedList
        title="Projects"
        description="Projects a sample can be assigned to. Sample creation requires one, so add at least one here."
        emptyMessage="No projects yet. Samples can't be created until at least one exists."
        items={withUsage(projects, projUsage)}
        createAction={createProject}
        renameAction={renameProject}
        deleteAction={deleteProject}
      />

      <ManagedList
        title="Chemical families"
        description="Groupings used on ingredient records — e.g. Terpene, Ester, Fatty alcohol."
        emptyMessage="No chemical families yet. Add the first one to populate the ingredient form."
        items={withUsage(chemicalFamilies, cfUsage)}
        createAction={createChemicalFamily}
        renameAction={renameChemicalFamily}
        deleteAction={deleteChemicalFamily}
        usageNoun="ingredient"
      />

      <ManagedList
        title="Regulatory functions"
        description="The regulatory role an ingredient plays — e.g. Preservative, UV filter."
        emptyMessage="No regulatory functions yet. Add the first one to populate the ingredient form."
        items={withUsage(regulatoryFunctions, rfUsage)}
        createAction={createRegulatoryFunction}
        renameAction={renameRegulatoryFunction}
        deleteAction={deleteRegulatoryFunction}
        usageNoun="ingredient"
      />
    </div>
  );
}
