#!/usr/bin/env node
// Prints fresh random values for the secret env vars. Usage: npm run gen-secrets
import { randomBytes } from "node:crypto";

console.log(`SESSION_SECRET="${randomBytes(48).toString("base64")}"
TOKEN_ENCRYPTION_KEY="${randomBytes(32).toString("base64")}"
CRON_SECRET="${randomBytes(32).toString("base64url")}"
META_WEBHOOK_VERIFY_TOKEN="${randomBytes(24).toString("base64url")}"`);
