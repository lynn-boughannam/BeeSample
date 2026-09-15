import { z } from "zod";
import {
  DOCUMENT_AVAILABILITY,
  FRAGRANCE_ORIENTATIONS,
  HAZARD_CLASSES,
  SAMPLE_CATEGORIES,
  SAMPLE_SOURCES,
  SHELF_LETTERS,
  SHELF_SUBLEVELS,
} from "@/lib/categories";
import { BIODEGRADABILITY, TRISTATE, YES_NO } from "@/lib/ingredients";
import { PIECE_MODES, pieceSumMessage, sumCents, toCents } from "@/lib/pieces";

// SLT-13. Function, Physical Form and Supplier are chosen from the admin-managed
// reference lists (see /settings/lists); the action additionally checks each submitted
// value still exists in its list.
export const CreateSampleSchema = z.object({
  // Auto-generation is paused — the Admin enters the code, and it must stay unique.
  sampleCode: z.string().min(1, "Sample code is required").trim(),
  rmName: z.string().min(1, "RM name is required").trim(),
  category: z.enum(SAMPLE_CATEGORIES, { error: "Select a category" }),
  // Only the shelf lookup reads this, and only for fragrances — a Natural Wax has no
  // orientation to give (SLT-13 field list, SLT-19 Part B). Required when Category is
  // Fragrance, blank otherwise; checkFragranceOrientation below enforces that.
  fragranceOrientation: z
    .union([z.literal(""), z.enum(FRAGRANCE_ORIENTATIONS)])
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  function: z.string().min(1, "Select a function").trim(),
  physicalForm: z.string().min(1, "Select a physical form").trim(),
  source: z.enum(SAMPLE_SOURCES, { error: "Select a source" }),
  supplier: z.string().min(1, "Select a supplier").trim(),
  projectName: z.string().min(1, "Select a project").trim(),
  hazardClass: z.enum(HAZARD_CLASSES, { error: "Select a hazard class" }),
  expiryDate: z.coerce.date({ error: "Enter a valid expiry date" }),
  receptionDate: z.coerce.date({ error: "Enter a valid reception date" }),
  receivedQtyG: z.coerce
    .number({ error: "Enter the received quantity in grams" })
    .positive("Received quantity must be greater than 0"),
  receivedQtyPcs: z.coerce
    .number({ error: "Enter the received quantity in pieces" })
    .int("Pieces must be a whole number")
    .positive("Received pieces must be greater than 0"),
  netWeightG: z
    .union([z.literal(""), z.coerce.number().positive("Net weight must be greater than 0")])
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  batchLot: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  documentAvailability: z
    .union([z.literal(""), z.enum(DOCUMENT_AVAILABILITY)])
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  ingredientIds: z.array(z.string().min(1)).min(1, "Select at least one INCI ingredient"),
  shelfLetter: z.enum(SHELF_LETTERS, { error: "Select a shelf row" }),
  shelfLevel: z.coerce
    .number({ error: "Select a shelf level" })
    .int()
    .min(1, "Shelf level must be between 1 and 5")
    .max(5, "Shelf level must be between 1 and 5"),
  shelfSublevel: z
    .union([z.literal(""), z.enum(SHELF_SUBLEVELS)])
    .transform((v) => (v === "" ? null : v))
    .nullable(),
});

// Fragrance Orientation is required exactly when the Category makes it meaningful. Kept
// as a standalone rule because CreateSampleSchema has to stay a plain object for the two
// schemas below to extend it.
function checkFragranceOrientation(
  value: { category: string; fragranceOrientation: string | null },
  ctx: z.RefinementCtx
) {
  if (value.category === "Fragrance" && value.fragranceOrientation === null) {
    ctx.addIssue({
      code: "custom",
      path: ["fragranceOrientation"],
      message: "Select a fragrance orientation — it sets the shelf row for fragrances.",
    });
  }
}

// Piece tracking is part of sample creation only, so it extends the create rules rather
// than living in them — Edit (below) must not inherit it.
export const CreateSampleWithPiecesSchema = CreateSampleSchema.extend({
  pieceMode: z.enum(PIECE_MODES, { error: "Choose how piece weights are set" }),
  // Only submitted in manual mode. Auto weights are deliberately not taken from the
  // client: the server recomputes them, so a tampered or stale form can't store a split
  // that doesn't add up to the total.
  pieceWeights: z.array(
    z.coerce
      .number({ error: "Enter a weight for every piece" })
      .positive("Each piece weight must be greater than 0")
  ),
}).superRefine((value, ctx) => {
  checkFragranceOrientation(value, ctx);

  if (value.pieceMode !== "MANUAL") return;

  if (value.pieceWeights.length !== value.receivedQtyPcs) {
    ctx.addIssue({
      code: "custom",
      path: ["pieceWeights"],
      message: `Enter a weight for all ${value.receivedQtyPcs} pieces.`,
    });
    return;
  }

  // Hard requirement, not a warning: the pieces must account for the whole receipt.
  const sum = sumCents(value.pieceWeights.map(toCents));
  const expected = toCents(value.receivedQtyG);
  if (sum !== expected) {
    ctx.addIssue({ code: "custom", path: ["pieceWeights"], message: pieceSumMessage(sum, expected) });
  }
});

// Editing reuses the create rules verbatim, plus the id of the row being changed.
// sampleCode is deliberately absent — it's system-generated and never user-editable.
export const UpdateSampleSchema = CreateSampleSchema.extend({
  id: z.string().min(1),
}).superRefine(checkFragranceOrientation);

// Discarding is the spec's soft-delete: the sample leaves the library but its history
// stays intact, so the reason is mandatory.
export const DiscardSampleSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1, "A reason is required to discard a sample").max(500).trim(),
});

// The ingredient compliance record. INCI Name is the only required field — the rest of
// a dossier arrives piecemeal, so everything else is optional and stored as null when
// left blank rather than as an empty string.
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const optionalRating = z
  .union([z.literal(""), z.coerce.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5")])
  .transform((v) => (v === "" ? null : v))
  .nullable();

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.literal(""), z.enum(values)])
    .transform((v) => (v === "" ? null : v))
    .nullable();

export const IngredientSchema = z.object({
  inciName: z.string().min(1, "INCI name is required").trim(),
  molecularFormula: optionalText,
  molecularWeight: optionalText,
  chemicalFamily: optionalText,
  // Several CAS numbers per INCI name; duplicates are collapsed case-insensitively.
  casNumbers: z
    .array(z.string().trim().min(1))
    .transform((vals) => {
      const seen = new Set<string>();
      return vals.filter((v) => {
        const key = v.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
  regulatoryFunction: optionalText,
  euRegulation: optionalEnum(YES_NO),
  euAnnex: optionalText,
  restriction: optionalText,
  euOpinion: optionalText,
  chinaListed: optionalEnum(YES_NO),
  endocrineDisruptor: optionalEnum(TRISTATE),
  cmr: optionalEnum(TRISTATE),
  dermalAbsorption: optionalText,
  noael: optionalText,
  biodegradability: optionalEnum(BIODEGRADABILITY),
  pbt: optionalEnum(YES_NO),
  aquaticToxicity: optionalEnum(YES_NO),
  aquaticHazardStatements: optionalText,
  yukaRating: optionalRating,
  inciBeautyRating: optionalRating,
  beeslineRating: optionalRating,
  comments: optionalText,
});

export const UpdateIngredientSchema = IngredientSchema.extend({
  id: z.string().min(1),
});

// Shared by the admin-managed reference lists (Functions, Physical Forms, Suppliers).
export const ListItemSchema = z.object({
  name: z.string().min(1, "Enter a name").max(100, "Name must be 100 characters or fewer").trim(),
});

export const RenameListItemSchema = ListItemSchema.extend({
  id: z.string().min(1),
});

export const CreateUserSchema = z.object({
  name: z.string().min(1, "Name is required").trim(),
  adUsername: z.string().min(1, "AD username is required").trim().toLowerCase(),
  roleId: z.string().min(1, "Role is required"),
});

export const UpdateUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Name is required").trim(),
  adUsername: z.string().min(1, "AD username is required").trim().toLowerCase(),
  roleId: z.string().min(1, "Role is required"),
});

// Stock In/Out (SLT-56, SLT-29). Both act on one physical piece, identified by id.
export const CheckoutPieceSchema = z.object({
  pieceId: z.string().min(1),
  formulatorId: z.string().min(1, "Select a formulator to check this piece out to"),
});

export const LogPieceUsageSchema = z.object({
  pieceId: z.string().min(1),
  // 0 is a real answer — the piece came back untouched — so this is non-negative rather
  // than positive. The upper bound is the piece's own remaining weight and can only be
  // checked against the row itself, so it lives in the action.
  amountUsedG: z.coerce
    .number({ error: "Enter the amount used in grams" })
    .nonnegative("Amount used can't be negative"),
});

// SLT-25. A restock is a genuine new batch, not a correction, so the amount must be a
// real positive weight — blank coerces to 0 and is rejected by the same rule.
export const AddReceivedStockSchema = z.object({
  sampleId: z.string().min(1),
  amountG: z.coerce
    .number({ error: "Enter the additional weight received in grams" })
    .positive("Additional weight received must be greater than 0"),
});

// SLT-55. The Admin picks which pieces expired from the tracked list rather than typing
// weights — each piece's weight is already known, so there is nothing to re-enter and
// nothing that can disagree with the tracked data.
export const DiscardPiecesSchema = z.object({
  sampleId: z.string().min(1),
  pieceIds: z.array(z.string().min(1)).min(1, "Select at least one piece to discard"),
  reason: z.string().trim().min(1, "Enter a reason for discarding these pieces"),
});
