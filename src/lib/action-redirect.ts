import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { withBasePath } from "./base-path";

/**
 * redirect() for SERVER ACTIONS, correct under a basePath (e.g. /instaflow).
 *
 * Next.js 16 handles the two ways an action can be invoked differently:
 *  - JS call (hydrated page; request has a `Next-Action` header): the client router adds the
 *    basePath to the redirect itself → pass the plain path.
 *  - Plain HTML form post (before hydration, or JS disabled): Next answers with a 303 whose
 *    Location does NOT include the basePath → add it here.
 * Use plain redirect() for external URLs.
 */
export async function actionRedirect(path: string): Promise<never> {
  const viaJs = (await headers()).has("next-action");
  redirect(viaJs ? path : withBasePath(path));
}
