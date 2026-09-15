"use client";

import { useActionState, useEffect, useState } from "react";
import { updateUser, setUserActive, deleteUser } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

type RoleOption = { id: string; name: string };

type UserRowData = {
  id: string;
  name: string;
  adUsername: string;
  roleId: string;
  role: { name: string };
  isActive: boolean;
};

export function UserRow({
  user,
  isSelf,
  roles,
}: {
  user: UserRowData;
  isSelf: boolean;
  roles: RoleOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(updateUser, undefined);

  useEffect(() => {
    if (hasSubmitted && !pending && !state?.error) {
      setEditing(false);
      setHasSubmitted(false);
    }
  }, [hasSubmitted, pending, state]);

  if (editing) {
    return (
      <tr className="border-t border-neutral-100">
        <td colSpan={5} className="p-3">
          <form
            action={formAction}
            onSubmit={() => setHasSubmitted(true)}
            className="grid grid-cols-4 items-start gap-3"
          >
            <input type="hidden" name="id" value={user.id} />
            <input
              name="name"
              defaultValue={user.name}
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <input
              name="adUsername"
              defaultValue={user.adUsername}
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <select
              name="roleId"
              defaultValue={user.roleId}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700"
              >
                Cancel
              </button>
            </div>
            {state?.error && <p className="col-span-4 text-sm text-red-600">{state.error}</p>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-neutral-100">
      <td className="px-4 py-2 text-neutral-900">
        {user.name} {isSelf && <span className="text-xs text-neutral-400">(you)</span>}
      </td>
      <td className="px-4 py-2 text-neutral-700">{user.adUsername}</td>
      <td className="px-4 py-2 text-neutral-700">{user.role.name}</td>
      <td className="px-4 py-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            user.isActive ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"
          }`}
        >
          {user.isActive ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="flex gap-2 px-4 py-2">
        <button
          onClick={() => setEditing(true)}
          className="text-sm font-medium text-neutral-700 hover:underline"
        >
          Edit
        </button>
        {!isSelf && (
          <>
            <form action={setUserActive.bind(null, user.id, !user.isActive)}>
              <button type="submit" className="text-sm font-medium text-neutral-700 hover:underline">
                {user.isActive ? "Deactivate" : "Activate"}
              </button>
            </form>
            <form action={deleteUser.bind(null, user.id)}>
              <ConfirmSubmitButton
                confirmMessage={`Delete ${user.name}? This cannot be undone.`}
                className="text-sm font-medium text-red-600 hover:underline"
              >
                Delete
              </ConfirmSubmitButton>
            </form>
          </>
        )}
      </td>
    </tr>
  );
}
