import type { Prisma } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { RatingPips } from "@/components/ui/rating-pips";
import {
  BIODEGRADABILITY_LABELS,
  TRISTATE_LABELS,
  type Biodegradability,
  type Tristate,
} from "@/lib/ingredients";

export type IngredientRow = Prisma.IngredientListEntryGetPayload<{
  include: { casNumbers: true; _count: { select: { sampleLinks: true } } };
}>;

export type IngredientColumn = {
  key: string;
  label: string;
  orderBy?: (dir: "asc" | "desc") => Prisma.IngredientListEntryOrderByWithRelationInput;
  render: (i: IngredientRow) => React.ReactNode;
  numeric?: boolean;
};

const dash = <span className="text-neutral-dark/40">—</span>;
const text = (v: string | null) => v ?? dash;

function yesNo(v: boolean | null) {
  if (v == null) return dash;
  return <Badge variant={v ? "success" : "danger"}>{v ? "Yes" : "No"}</Badge>;
}

// PBT / aquatic toxicity invert: "Yes" is the concerning answer, so it shows red.
function yesNoInverted(v: boolean | null) {
  if (v == null) return dash;
  return <Badge variant={v ? "danger" : "success"}>{v ? "Yes" : "No"}</Badge>;
}

function tristate(v: string | null) {
  if (!v) return dash;
  const label = TRISTATE_LABELS[v as Tristate] ?? v;
  if (v === "NA") return <Badge variant="neutral">{label}</Badge>;
  return <Badge variant={v === "YES" ? "danger" : "success"}>{label}</Badge>;
}

export const INGREDIENT_COLUMNS: IngredientColumn[] = [
  { key: "uid", label: "Code", orderBy: (d) => ({ uid: d }), render: (i) => i.uid ?? dash },
  { key: "inciName", label: "INCI Name", orderBy: (d) => ({ inciName: d }), render: (i) => i.inciName },
  {
    key: "chemicalFamily",
    label: "Chemical Family",
    orderBy: (d) => ({ chemicalFamily: d }),
    render: (i) => text(i.chemicalFamily),
  },
  {
    key: "casNumbers",
    label: "CAS Numbers",
    // Multi-value relation — there's no meaningful single value to order on.
    render: (i) =>
      i.casNumbers.length === 0 ? (
        dash
      ) : (
        <span className="flex flex-wrap gap-1">
          {i.casNumbers.map((c) => (
            <Badge key={c.id} variant="neutral">
              {c.value}
            </Badge>
          ))}
        </span>
      ),
  },
  {
    key: "regulatoryFunction",
    label: "Regulatory Function",
    orderBy: (d) => ({ regulatoryFunction: d }),
    render: (i) => text(i.regulatoryFunction),
  },
  {
    key: "beeslineRating",
    label: "Beesline Rating",
    orderBy: (d) => ({ beeslineRating: d }),
    render: (i) => <RatingPips value={i.beeslineRating} />,
  },
  {
    key: "yukaRating",
    label: "YUKA Rating",
    orderBy: (d) => ({ yukaRating: d }),
    render: (i) => <RatingPips value={i.yukaRating} />,
  },
  {
    key: "inciBeautyRating",
    label: "INCI Beauty Rating",
    orderBy: (d) => ({ inciBeautyRating: d }),
    render: (i) => <RatingPips value={i.inciBeautyRating} />,
  },
  {
    key: "molecularFormula",
    label: "Molecular Formula",
    orderBy: (d) => ({ molecularFormula: d }),
    render: (i) => text(i.molecularFormula),
  },
  {
    key: "molecularWeight",
    label: "Molecular Weight",
    orderBy: (d) => ({ molecularWeight: d }),
    render: (i) => text(i.molecularWeight),
  },
  {
    key: "euRegulation",
    label: "EU Regulation",
    orderBy: (d) => ({ euRegulation: d }),
    render: (i) => yesNo(i.euRegulation),
  },
  { key: "euAnnex", label: "EU Annex", orderBy: (d) => ({ euAnnex: d }), render: (i) => text(i.euAnnex) },
  {
    key: "restriction",
    label: "Restriction",
    orderBy: (d) => ({ restriction: d }),
    render: (i) => text(i.restriction),
  },
  {
    key: "euOpinion",
    label: "EU Opinion",
    orderBy: (d) => ({ euOpinion: d }),
    render: (i) => text(i.euOpinion),
  },
  {
    key: "chinaListed",
    label: "China Listed",
    orderBy: (d) => ({ chinaListed: d }),
    render: (i) => yesNo(i.chinaListed),
  },
  {
    key: "endocrineDisruptor",
    label: "Endocrine Disruptor",
    orderBy: (d) => ({ endocrineDisruptor: d }),
    render: (i) => tristate(i.endocrineDisruptor),
  },
  { key: "cmr", label: "CMR", orderBy: (d) => ({ cmr: d }), render: (i) => tristate(i.cmr) },
  {
    key: "dermalAbsorption",
    label: "Dermal Absorption (DAP)",
    orderBy: (d) => ({ dermalAbsorption: d }),
    render: (i) => text(i.dermalAbsorption),
  },
  { key: "noael", label: "NOAEL", orderBy: (d) => ({ noael: d }), render: (i) => text(i.noael) },
  {
    key: "biodegradability",
    label: "Biodegradability",
    orderBy: (d) => ({ biodegradability: d }),
    render: (i) =>
      i.biodegradability
        ? BIODEGRADABILITY_LABELS[i.biodegradability as Biodegradability] ?? i.biodegradability
        : dash,
  },
  { key: "pbt", label: "PBT", orderBy: (d) => ({ pbt: d }), render: (i) => yesNoInverted(i.pbt) },
  {
    key: "aquaticToxicity",
    label: "Aquatic Toxicity",
    orderBy: (d) => ({ aquaticToxicity: d }),
    render: (i) => yesNoInverted(i.aquaticToxicity),
  },
  {
    key: "aquaticHazardStatements",
    label: "Hazard Statements",
    orderBy: (d) => ({ aquaticHazardStatements: d }),
    render: (i) => text(i.aquaticHazardStatements),
  },
  {
    key: "usedIn",
    label: "Used In",
    orderBy: (d) => ({ sampleLinks: { _count: d } }),
    render: (i) => i._count.sampleLinks,
    numeric: true,
  },
];

export const INGREDIENT_DEFAULT_COLUMNS = [
  "uid",
  "inciName",
  "chemicalFamily",
  "casNumbers",
  "regulatoryFunction",
  "beeslineRating",
];

export function resolveIngredientColumns(colsParam: string | undefined): IngredientColumn[] {
  if (!colsParam) {
    return INGREDIENT_COLUMNS.filter((c) => INGREDIENT_DEFAULT_COLUMNS.includes(c.key));
  }
  const wanted = new Set(colsParam.split(",").filter(Boolean));
  const picked = INGREDIENT_COLUMNS.filter((c) => wanted.has(c.key));
  return picked.length > 0
    ? picked
    : INGREDIENT_COLUMNS.filter((c) => INGREDIENT_DEFAULT_COLUMNS.includes(c.key));
}
