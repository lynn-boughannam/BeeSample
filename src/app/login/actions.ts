"use server";

import { AuthError } from "next-auth";
import { signIn, AccountDeactivatedError } from "@/lib/auth";

export type LoginState = { error?: string } | undefined;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      adUsername: formData.get("adUsername"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // Check the specific subclass before the generic AuthError check — SLT-9 wants a
    // distinct message for a deactivated account, while wrong password and "not
    // provisioned" stay on the generic message below (don't help enumerate accounts).
    if (error instanceof AccountDeactivatedError) {
      return { error: "This account has been deactivated. Contact your administrator." };
    }
    if (error instanceof AuthError) {
      return { error: "Invalid username or password." };
    }
    throw error;
  }
}
