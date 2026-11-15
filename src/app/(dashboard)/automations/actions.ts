"use server";

import { revalidatePath } from "next/cache";
import { actionRedirect } from "@/lib/action-redirect";
import { requireAuth } from "@/lib/auth";
import { deleteAutomation, saveAutomation, setAutomationActive } from "@/lib/automations/store";
import type { ValidationResult } from "@/lib/automations/schema";
import { simulateComment, type SimulationInput, type SimulationResult } from "@/lib/flow/simulate";

// Server actions are reachable by POST, so each one re-checks the session itself.

export type SaveState = { ok: false; validation: ValidationResult } | { ok: false; error: string } | undefined;

/** Called directly from the editor with the form's JSON state. Redirects to the list on success. */
export async function saveAutomationAction(id: string | null, input: unknown): Promise<SaveState> {
  await requireAuth();
  let result;
  try {
    result = await saveAutomation(id, input);
  } catch (err) {
    console.error("[automations] save failed:", err);
    return { ok: false, error: "Couldn't save the automation. Check the server logs." };
  }
  if (!result.ok) return result;
  revalidatePath("/automations");
  await actionRedirect(`/automations?saved=${encodeURIComponent(result.id)}`);
}

export async function toggleAutomationAction(id: string, active: boolean): Promise<{ error?: string }> {
  await requireAuth();
  try {
    await setAutomationActive(id, active);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update the automation." };
  }
  revalidatePath("/automations");
  return {};
}

export async function simulateAction(
  id: string,
  input: SimulationInput,
): Promise<{ ok: true; result: SimulationResult } | { ok: false; error: string }> {
  await requireAuth();
  const comment = String(input.comment ?? "").slice(0, 2200);
  const username = String(input.username ?? "").replace(/^@/, "").trim().slice(0, 30) || "test.user";
  const name = String(input.name ?? "").trim().slice(0, 60) || "Test User";
  const f = input.followsAfterChecks;
  const followsAfterChecks = f === null ? null : Math.min(Math.max(Number(f) || 0, 0), 20);
  if (!comment.trim()) return { ok: false, error: "Enter a comment to simulate." };
  try {
    const result = await simulateComment(id, { comment, username, name, followsAfterChecks });
    revalidatePath("/logs");
    return { ok: true, result };
  } catch (err) {
    console.error("[simulate] failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Simulation failed." };
  }
}

export async function deleteAutomationAction(id: string): Promise<void> {
  await requireAuth();
  await deleteAutomation(id);
  revalidatePath("/automations");
  await actionRedirect("/automations?deleted=1");
}
