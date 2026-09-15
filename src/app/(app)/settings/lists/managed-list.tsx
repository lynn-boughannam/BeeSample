"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

type ActionState = { error?: string } | undefined;
type FormAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export type ListItem = { id: string; name: string; inUse: number };

export function ManagedList({
  title,
  description,
  emptyMessage,
  items,
  createAction,
  renameAction,
  deleteAction,
  // What consumes this list — samples for the sample-form lists, ingredients for the
  // compliance ones.
  usageNoun = "sample",
}: {
  title: string;
  description: string;
  emptyMessage: string;
  items: ListItem[];
  createAction: FormAction;
  renameAction: FormAction;
  deleteAction: (id: string, name: string) => Promise<void>;
  usageNoun?: string;
}) {
  const [state, formAction, pending] = useActionState(createAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
      <h2 className="text-section-header text-neutral-dark">{title}</h2>
      <p className="text-caption mt-0.5 mb-4 text-neutral-dark/60">{description}</p>

      <form
        ref={formRef}
        action={async (fd) => {
          await formAction(fd);
          formRef.current?.reset();
        }}
        className="flex items-start gap-2"
      >
        <div className="flex-1">
          <Input name="name" placeholder={`Add a ${title.replace(/s$/, "").toLowerCase()}…`} invalid={Boolean(state?.error)} />
          {state?.error && <p className="text-caption mt-1 text-danger">{state.error}</p>}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </form>

      <ul className="mt-4 divide-y divide-neutral-dark/8 rounded-lg border border-neutral-dark/10">
        {items.length === 0 ? (
          <li className="text-body px-4 py-8 text-center text-neutral-dark/50">{emptyMessage}</li>
        ) : (
          items.map((item) => (
            <ListRow
              key={item.id}
              item={item}
              renameAction={renameAction}
              deleteAction={deleteAction}
              usageNoun={usageNoun}
            />
          ))
        )}
      </ul>
    </section>
  );
}

function ListRow({
  item,
  renameAction,
  deleteAction,
  usageNoun,
}: {
  item: ListItem;
  renameAction: FormAction;
  deleteAction: (id: string, name: string) => Promise<void>;
  usageNoun: string;
}) {
  const [editing, setEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(renameAction, undefined);

  // Close the editor only once the rename actually succeeded, so a duplicate-name error
  // stays visible against the field the user is still editing.
  useEffect(() => {
    if (submitted && !pending && !state?.error) {
      setEditing(false);
      setSubmitted(false);
    }
  }, [submitted, pending, state]);

  if (editing) {
    return (
      <li className="px-4 py-2.5">
        <form
          action={formAction}
          onSubmit={() => setSubmitted(true)}
          className="flex items-start gap-2"
        >
          <input type="hidden" name="id" value={item.id} />
          <div className="flex-1">
            <Input name="name" defaultValue={item.name} invalid={Boolean(state?.error)} autoFocus />
            {state?.error && <p className="text-caption mt-1 text-danger">{state.error}</p>}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-body flex-1 text-neutral-dark">{item.name}</span>

      {item.inUse > 0 && (
        <span className="text-caption text-neutral-dark/50">
          used by {item.inUse} {usageNoun}
          {item.inUse === 1 ? "" : "s"}
        </span>
      )}

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-body font-medium text-neutral-dark transition-opacity hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary/40"
      >
        Edit
      </button>

      {item.inUse > 0 ? (
        // Blocked in the action too — this just explains why rather than failing silently.
        <span
          className="text-body cursor-not-allowed text-neutral-dark/30"
          title={`In use by existing ${usageNoun}s`}
        >
          Delete
        </span>
      ) : (
        <form action={deleteAction.bind(null, item.id, item.name)}>
          <ConfirmSubmitButton
            confirmMessage={`Delete "${item.name}"?`}
            className="text-body font-medium text-danger transition-opacity hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
          >
            Delete
          </ConfirmSubmitButton>
        </form>
      )}
    </li>
  );
}
