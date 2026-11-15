"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearSessionCookie, getPasswordHash, setSessionCookie } from "@/lib/auth";
import { clearLoginAttempts, consumeLoginAttempt, getClientIp } from "@/lib/rate-limit";

export type LoginState = { error: string } | undefined;

/** Only allow same-site relative paths, to avoid open redirects. */
function safeRedirectPath(value: FormDataEntryValue | null): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.startsWith("/login")
  ) {
    return "/";
  }
  return value;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0 || password.length > 256) {
    return { error: "Incorrect password." };
  }

  const hash = getPasswordHash();
  if (!hash) return { error: "Server is misconfigured. Check the server logs." };

  const ip = getClientIp(await headers());
  const limit = await consumeLoginAttempt(ip);
  if (limit.limited) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  if (!(await bcrypt.compare(password, hash))) {
    return { error: "Incorrect password." };
  }

  await clearLoginAttempts(ip);
  await setSessionCookie();
  redirect(safeRedirectPath(formData.get("from")));
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
