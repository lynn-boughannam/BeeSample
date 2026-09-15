"use client";

import Image from "next/image";
import { useActionState } from "react";
import { login } from "./actions";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-light px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-dark/10 bg-white p-8 shadow-elevated">
        <Image src="/brand/logo-light.jpg" alt="BeeSample" width={160} height={89} className="mb-6" />
        <h1 className="text-section-header mb-1 text-neutral-dark">Sign in</h1>
        <p className="text-body mb-6 text-neutral-dark/60">
          Standardization Unit sample library
        </p>

        <form action={formAction} className="space-y-4">
          <FormField label="Username" htmlFor="adUsername">
            <Input id="adUsername" name="adUsername" type="text" required autoComplete="username" />
          </FormField>

          <FormField label="Password" htmlFor="password" error={state?.error}>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              invalid={Boolean(state?.error)}
            />
          </FormField>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
