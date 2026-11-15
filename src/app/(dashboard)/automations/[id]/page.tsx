import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAutomation, toInput } from "@/lib/automations/store";
import { getOwnAccount } from "@/lib/instagram-account";
import { AutomationEditor } from "../editor/automation-editor";

export const metadata: Metadata = { title: "Edit automation · InstaFlow" };

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [automation, own] = await Promise.all([getAutomation(id), getOwnAccount()]);
  if (!automation) notFound();

  return (
    <AutomationEditor
      id={automation.id}
      initial={toInput(automation)}
      ownUsername={own?.username ?? "yourbrand"}
      instagramConnected={!!own}
    />
  );
}
