"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { NAV_ITEMS } from "@/lib/nav";
import type { Role } from "@/lib/types";

export async function setMenuVisibility(navKey: string, role: Role, isHidden: boolean) {
  await requireAdmin();

  const item = NAV_ITEMS.find((i) => i.key === navKey);
  // Dashboard and Menu Settings itself can never be hidden, for either role.
  if (!item || item.pinned) return;

  await prisma.menuSetting.upsert({
    where: { navKey_role: { navKey, role } },
    update: { isHidden },
    create: { navKey, role, isHidden },
  });

  revalidatePath("/settings/menu");
}
