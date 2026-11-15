#!/usr/bin/env node
// Builds a self-contained server bundle for a VPS: .next/standalone (run with `node server.js`).
// Usage: BASE_PATH=/instaflow PUBLIC_URL=https://example.com npm run build:standalone
//   BASE_PATH   sub-path the app is served under ("" for the domain root)
//   PUBLIC_URL  public origin; used to derive META_REDIRECT_URI at build time (trusted host)
import { execSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

const basePath = process.env.BASE_PATH ?? "";
const publicUrl = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
const root = process.cwd();
const out = path.join(root, ".next", "standalone");

rmSync(out, { recursive: true, force: true });
execSync("npx next build", {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_OUTPUT: "standalone",
    NEXT_PUBLIC_BASE_PATH: basePath,
    ...(publicUrl ? { META_REDIRECT_URI: `${publicUrl}${basePath}/api/instagram/callback` } : {}),
  },
});

// Next copies .env* into the bundle; secrets belong in the server's environment, never in the bundle.
for (const f of readdirSync(out)) {
  if (f.startsWith(".env")) {
    rmSync(path.join(out, f));
    console.log(`removed ${f} from bundle`);
  }
}
// Turbopack links externals as .next/node_modules/<pkg>-<hash> -> node_modules/<pkg> using ABSOLUTE
// paths of the build machine. Replace each link with a real copy so the bundle runs anywhere.
function materializeLinks(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      const target = realpathSync(p);
      rmSync(p, { recursive: true, force: true });
      cpSync(target, p, { recursive: true, dereference: true });
      console.log(`materialized ${path.relative(out, p)}`);
    } else if (st.isDirectory() && name.startsWith("@")) {
      materializeLinks(p);
    }
  }
}
materializeLinks(path.join(out, ".next", "node_modules"));

cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
console.log(`\nStandalone bundle ready: ${out}\nRun on the server with: node server.js (PORT, HOSTNAME and app env vars set)`);
