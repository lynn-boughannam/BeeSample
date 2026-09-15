"use client";

import { useState, useTransition } from "react";
import { setMenuVisibility } from "./actions";
import type { Role } from "@/lib/types";

export function MenuToggle({
  navKey,
  role,
  initiallyHidden,
}: {
  navKey: string;
  role: Role;
  initiallyHidden: boolean;
}) {
  const [hidden, setHidden] = useState(initiallyHidden);
  const [isPending, startTransition] = useTransition();

  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={!hidden}
        disabled={isPending}
        onChange={(e) => {
          const nextHidden = !e.target.checked;
          setHidden(nextHidden);
          startTransition(async () => {
            await setMenuVisibility(navKey, role, nextHidden);
          });
        }}
        className="h-4 w-4 rounded border-neutral-300"
      />
      <span className="text-xs text-neutral-500">{hidden ? "Hidden" : "Visible"}</span>
    </label>
  );
}
