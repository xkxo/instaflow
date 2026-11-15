import type { Metadata } from "next";
import { DEFAULT_AUTOMATION } from "@/lib/automations/schema";
import { getOwnAccount } from "@/lib/instagram-account";
import { AutomationEditor } from "../editor/automation-editor";

export const metadata: Metadata = { title: "New automation · InstaFlow" };

export default async function NewAutomationPage() {
  const own = await getOwnAccount();
  return (
    <AutomationEditor
      id={null}
      initial={DEFAULT_AUTOMATION}
      ownUsername={own?.username ?? "yourbrand"}
      instagramConnected={!!own}
    />
  );
}
