import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { RatingPips } from "@/components/ui/rating-pips";
import {
  BIODEGRADABILITY_LABELS,
  TRISTATE_LABELS,
  type Biodegradability,
  type Tristate,
} from "@/lib/ingredients";

export default async function IngredientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await verifySession();
  const isAdmin = session.user.role === "ADMIN";

  const ing = await prisma.ingredientListEntry.findUnique({
    where: { id },
    include: {
      casNumbers: true,
      _count: { select: { sampleLinks: true } },
      sampleLinks: { include: { sample: true }, take: 20 },
    },
  });

  if (!ing) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/ingredients" className="text-caption text-neutral-dark/60 hover:underline">
          ← Ingredient List
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-page-title text-neutral-dark">{ing.inciName}</h1>
            <p className="text-body mt-0.5 text-neutral-dark/60">{ing.uid}</p>
          </div>
          {isAdmin && (
            <Link
              href={`/ingredients/${ing.id}/edit`}
              className="text-body inline-flex items-center rounded-lg bg-brand-primary px-4 py-2 font-medium text-on-primary transition-[transform,opacity] duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Edit ingredient
            </Link>
          )}
        </div>
      </div>

      <Card title="Ratings">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <RatingRow label="YUKA" value={ing.yukaRating} />
          <RatingRow label="INCI Beauty" value={ing.inciBeautyRating} />
          <RatingRow label="Beesline" value={ing.beeslineRating} />
        </dl>
      </Card>

      <Card title="Identification">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Chemical family">{ing.chemicalFamily ?? <Empty />}</Field>
          <Field label="Regulatory function">{ing.regulatoryFunction ?? <Empty />}</Field>
          <Field label="Molecular formula">{ing.molecularFormula ?? <Empty />}</Field>
          <Field label="Molecular weight">{ing.molecularWeight ?? <Empty />}</Field>
          <Field label="CAS numbers">
            {ing.casNumbers.length === 0 ? (
              <Empty />
            ) : (
              <span className="flex flex-wrap gap-1">
                {ing.casNumbers.map((c) => (
                  <Badge key={c.id} variant="neutral">
                    {c.value}
                  </Badge>
                ))}
              </span>
            )}
          </Field>
        </dl>
      </Card>

      <Card title="Regulatory status">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="EU Regulation">
            <YesNo value={ing.euRegulation} />
          </Field>
          <Field label="China listed">
            <YesNo value={ing.chinaListed} />
          </Field>
          <Field label="EU Annex">{ing.euAnnex ?? <Empty />}</Field>
          <Field label="Restriction">{ing.restriction ?? <Empty />}</Field>
          <Field label="EU Opinion">{ing.euOpinion ?? <Empty />}</Field>
        </dl>
      </Card>

      <Card title="Toxicology">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Endocrine disruptor">
            <TristateValue value={ing.endocrineDisruptor} />
          </Field>
          <Field label="CMR">
            <TristateValue value={ing.cmr} />
          </Field>
          <Field label="Dermal absorption (DAP)">{ing.dermalAbsorption ?? <Empty />}</Field>
          <Field label="NOAEL (mg/kg bw/day)">{ing.noael ?? <Empty />}</Field>
        </dl>
      </Card>

      <Card title="Environmental">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Biodegradability">
            {ing.biodegradability ? (
              BIODEGRADABILITY_LABELS[ing.biodegradability as Biodegradability]
            ) : (
              <Empty />
            )}
          </Field>
          <Field label="PBT">
            <YesNo value={ing.pbt} invert />
          </Field>
          <Field label="Aquatic toxicity">
            <YesNo value={ing.aquaticToxicity} invert />
          </Field>
          <Field label="Hazard statements">{ing.aquaticHazardStatements ?? <Empty />}</Field>
        </dl>
      </Card>

      {ing.comments && (
        <Card title="Comments">
          <p className="text-body whitespace-pre-wrap text-neutral-dark">{ing.comments}</p>
        </Card>
      )}

      <Card title={`Used in ${ing._count.sampleLinks} sample${ing._count.sampleLinks === 1 ? "" : "s"}`}>
        {ing.sampleLinks.length === 0 ? (
          <p className="text-body text-neutral-dark/50">
            Not referenced by any sample. It can be deleted from the ingredient list.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ing.sampleLinks.map((link) => (
              <li key={link.sampleId}>
                <Link
                  href={`/library/${link.sampleId}`}
                  className="text-caption inline-flex items-center rounded-full bg-neutral-dark/8 px-2.5 py-0.5 font-medium text-neutral-dark hover:underline"
                >
                  {link.sample.sampleCode} · {link.sample.rmName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
      <h2 className="text-section-header mb-4 text-neutral-dark">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-neutral-dark/50">{label}</dt>
      <dd className="text-body mt-0.5 text-neutral-dark">{children}</dd>
    </div>
  );
}

function RatingRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-caption text-neutral-dark/50">{label}</dt>
      <dd className="mt-1">
        <RatingPips value={value} />
      </dd>
    </div>
  );
}

function Empty() {
  return <span className="text-neutral-dark/40">Not recorded</span>;
}

// Green for yes, red for no. `invert` flips which answer is the good one — being on a
// regulation is reassuring, being a PBT is not.
function YesNo({ value, invert }: { value: boolean | null; invert?: boolean }) {
  if (value == null) return <Empty />;
  const good = invert ? !value : value;
  return (
    <Badge variant={good ? "success" : "danger"}>{value ? "Yes" : "No"}</Badge>
  );
}

function TristateValue({ value }: { value: string | null }) {
  if (!value) return <Empty />;
  const label = TRISTATE_LABELS[value as Tristate] ?? value;
  if (value === "NA") return <Badge variant="neutral">{label}</Badge>;
  // "Yes" to a CMR or endocrine-disruptor question is the concerning answer.
  return <Badge variant={value === "YES" ? "danger" : "success"}>{label}</Badge>;
}
