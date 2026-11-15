#!/usr/bin/env node
// `npm run deploy` — runs scripts/deploy.sh with bash on any OS.
// On Windows npm scripts run in cmd.exe, where bash usually isn't on PATH: use Git Bash.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findBash() {
  if (process.platform !== "win32") return "bash";
  const candidates = [];
  try {
    // …\Git\cmd\git.exe → …\Git\bin\bash.exe
    const git = execFileSync("where.exe", ["git"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
    if (git) candidates.push(join(dirname(git), "..", "bin", "bash.exe"));
  } catch {}
  candidates.push("C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe");
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error("Couldn't find bash. Install Git for Windows (it includes Git Bash), or run scripts/deploy.sh from WSL.");
    process.exit(1);
  }
  return found;
}

const script = join(dirname(fileURLToPath(import.meta.url)), "deploy.sh");
const r = spawnSync(findBash(), [script, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
