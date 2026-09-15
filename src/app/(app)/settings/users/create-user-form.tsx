"use client";

import { useActionState, useRef } from "react";
import { createUser } from "./actions";

type RoleOption = { id: string; name: string };

export function CreateUserForm({ roles }: { roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState(createUser, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await formAction(formData);
        formRef.current?.reset();
      }}
      className="grid grid-cols-4 gap-3 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <input
        name="name"
        placeholder="Name"
        required
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />
      <input
        name="adUsername"
        placeholder="AD username"
        required
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />
      <select
        name="roleId"
        defaultValue=""
        required
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      >
        <option value="" disabled>
          Select role
        </option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add User"}
      </button>
      {state?.error && <p className="col-span-4 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
