#!/usr/bin/env node
// Prompts for a password (input hidden) and prints a bcrypt hash for APP_PASSWORD_HASH.
// Usage: npm run hash-password
import bcrypt from "bcryptjs";
import readline from "node:readline";
import { Writable } from "node:stream";

const COST = 12;
const MIN_LENGTH = 12;

// Echo prompts, but swallow the characters typed after them.
let muted = false;
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(question) {
  muted = false;
  output.write(question);
  muted = true;
  const { value, done } = await lines.next();
  muted = false;
  process.stdout.write("\n");
  if (done) {
    console.error("No input received.");
    process.exit(1);
  }
  return value;
}

const password = await ask("Password: ");
if (password.length < MIN_LENGTH) {
  console.error(`Password must be at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
const confirm = await ask("Confirm password: ");
rl.close();
if (password !== confirm) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, COST);

console.log(`
Add this to your .env file ($ signs are escaped so Next.js doesn't expand them):

APP_PASSWORD_HASH=${hash.replaceAll("$", "\\$")}

For the Vercel / Railway dashboard, paste the raw value instead:

${hash}
`);
