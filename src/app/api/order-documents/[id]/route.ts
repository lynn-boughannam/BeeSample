import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Supplier paperwork is streamed back through here rather than served as a static file,
// so a document is only readable by someone with a session. Anyone who can see the order
// can read its documents; a Formulator only ever sees their own request.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Not signed in", { status: 401 });
  }

  const doc = await prisma.sampleOrderSupplierDocument.findUnique({
    where: { id },
    include: {
      orderSupplier: { include: { order: { select: { orderedById: true } } } },
    },
  });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const role = session.user.role;
  const worksOrders = role === "ADMIN" || role === "SUPPLY_CHAIN" || role === "CSS";
  if (!worksOrders && doc.orderSupplier.order.orderedById !== session.user.id) {
    // Same answer as a missing document: whether one exists isn't this user's business.
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(doc.content), {
    headers: {
      "Content-Type": doc.contentType || "application/octet-stream",
      // inline so a PDF opens in the browser rather than forcing a download; the quotes
      // keep a filename with spaces intact.
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Content-Length": String(doc.content.length),
      // Private: it's behind a session, so no shared cache should keep a copy.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
