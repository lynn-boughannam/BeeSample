"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { prepareSampleCreate } from "@/lib/sample-creation";
import { canReceiveOrder, checkReceiptReady, orderStatusAfterReceipt } from "@/lib/orders";

// Phase 9 — the material arrives and becomes a real sample.
//
// Not a status change with a sample tacked on: the order produces a Sample row with its own
// pieces and its own shelf slot, identical to one an Admin types in directly, because from
// here on nothing in the library cares where it came from. That identity is why this goes
// through prepareSampleCreate rather than writing its own create.

export type ReceiveState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

export async function receiveOrder(
  _prev: ReceiveState,
  formData: FormData
): Promise<ReceiveState> {
  const session = await requireAdmin();
  if (!canReceiveOrder(session.user.role)) {
    return { formError: "Only an Admin can record a reception." };
  }

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { formError: "Which request?" };

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, producedSampleId: true },
  });
  if (!order) return { formError: "That request no longer exists." };

  // Re-checked against the stored row: the page may have been open since before someone
  // else received it, and receiving twice would put two samples on the shelf for one
  // delivery.
  const ready = checkReceiptReady(order);
  if (!ready.ok) return { formError: ready.reason };

  const prepared = await prepareSampleCreate(formData, session.user.id);
  if (!prepared.ok) {
    return { fieldErrors: prepared.fieldErrors, formError: prepared.formError };
  }

  let sampleId: string;
  try {
    sampleId = await prisma.$transaction(async (tx) => {
      const sample = await tx.sample.create({
        data: prepared.data,
        select: { id: true },
      });

      // The order is closed against the sample it produced in the same transaction. A
      // sample with no order pointing at it would look like direct entry; an order marked
      // received with no sample would be a delivery nobody can find.
      await tx.sampleOrder.update({
        where: { id: orderId },
        data: {
          status: orderStatusAfterReceipt(),
          receivedAt: prepared.data.receptionDate,
          receivedSampleCode: prepared.data.sampleCode,
          producedSampleId: sample.id,
        },
      });

      return sample.id;
    });
  } catch (error) {
    console.error("receiveOrder failed", error);
    return { formError: "Could not record that reception. Try again." };
  }

  revalidatePath("/library");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/dashboard");
  // Onto the sample itself: it is what the reception produced, and seeing its pieces and
  // shelf slot is how Rawan knows the delivery landed where she put it.
  redirect(`/library/${sampleId}`);
}
