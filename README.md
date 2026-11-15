# InstaFlow

A private, single-user Instagram automation tool (ManyChat-style).

**What works so far:**

- **Login:** password-only login, a session cookie, route protection, and a rate limiter for login attempts.
- **Dashboard:** an empty shell with a sidebar.
- **Instagram connection:** connects an Instagram professional account through the **Instagram API with Unified Login** (`graph.facebook.com`). The access token is encrypted at rest and checked daily.
- **Webhooks:** real-time comments, DMs, quick replies and postbacks arrive from Meta. Signatures are verified, events are deduplicated and stored, and they appear on a live Logs page.
- **Automation builder:** you can create comment-to-DM automations with a live phone preview.
- **Flow engine:** runs automations end to end:
  - comment → public reply → private-reply DM → opt-in tap → follow gate → link delivered;
  - work goes through a DB-backed job queue with retries and backoff;
  - every run has a timeline;
  - there's a dashboard funnel, a Contacts page, and a dry-run "Simulate comment".

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Prisma 7 + PostgreSQL · jose · bcryptjs

---

## Local setup

**Requirements:** Node.js 20.19 or newer, and a PostgreSQL database.

### 1. Install

```bash
npm install
```

This also runs `prisma generate`.

### 2. Get a database

Pick one:

- **Neon or Supabase (recommended, matches production).** Create a project and copy its connection strings.
- **Local, no Docker:**
  1. Run `npx prisma dev --name instaflow`. It starts a local Postgres and prints a `TCP: postgres://...@localhost:<port>/template1...` URL.
  2. Use that URL as `DATABASE_URL`.
  3. Set `SHADOW_DATABASE_URL` to the same URL with the port number plus one. Prisma needs this second database to create migrations.

### 3. Create `.env`

```bash
cp .env.example .env
npm run gen-secrets   # prints SESSION_SECRET, TOKEN_ENCRYPTION_KEY, CRON_SECRET, META_WEBHOOK_VERIFY_TOKEN
```

Paste the generated secrets into `.env` and fill in the rest:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | Your Postgres connection string. On Neon or Supabase, use the **pooled** URL. |
| `DIRECT_URL` | Optional. A direct (non-pooled) URL that Prisma uses for migrations. |
| `SHADOW_DATABASE_URL` | Only needed with `npx prisma dev` (see step 2). |
| `SESSION_SECRET` | From `gen-secrets`. Must be 32 characters or more. |
| `APP_PASSWORD_HASH` | From `npm run hash-password` (see the next step). |
| `META_APP_ID`, `META_APP_SECRET` | Your Meta app's ID and secret. See [Connecting Instagram](#connecting-instagram). |
| `META_LOGIN_CONFIG_ID` | The config ID of your Unified Login configuration. |
| `META_REDIRECT_URI` | `https://<your-host>/api/instagram/callback` |
| `TOKEN_ENCRYPTION_KEY` | From `gen-secrets`: 32 random bytes, base64-encoded. |
| `CRON_SECRET` | From `gen-secrets`. |
| `META_WEBHOOK_VERIFY_TOKEN` | From `gen-secrets`. You'll paste the same value into the App Dashboard. See [Receiving webhooks](#receiving-webhooks). |

### 4. Set your password

```bash
npm run hash-password
```

The script asks for your password twice. The password must be at least 12 characters, and it isn't shown as you type. The script then prints two versions of the hash:

- **For `.env`:** every `$` is escaped as `\$`. Paste this line as it is.
- **For the Vercel or Railway dashboard:** the raw hash.

> **Why the escaping?** Next.js expands `$VAR` references in `.env` files. An unescaped bcrypt hash such as `$2b$12$abc...` is silently cut down to a fragment, and login never succeeds. If this happens, the server logs a clear error and the login page shows "Server is misconfigured".

### 5. Create the database tables

```bash
npm run db:migrate
```

### 6. Run

```bash
npm run dev
```

Open http://localhost:3000. You'll be redirected to `/login`.

---

g## Connecting Instagram

InstaFlow uses the **Instagram API with Unified Login**, which is Meta's recommended setup for new apps.

- **How login works:** it's Facebook Login for Business with a **login configuration** (`config_id`). You can sign in with Instagram or Facebook. You don't need a Facebook Page.
- **The token:** login returns a **Business Integration System User access token**. It belongs to your business portfolio rather than to your personal account, and with "Never" expiry it doesn't need refreshing.
- **API host:** all API calls go to `graph.facebook.com`. The version is set once, as `GRAPH_API_VERSION` in `src/lib/instagram.ts` (currently `v27.0`).
- **Not used:** this app does **not** use Business Login for Instagram or `graph.instagram.com`.

### 1. Make your Instagram account a professional account

The API only works with **Business** or **Creator** accounts. To switch, open the Instagram app and go to **Settings → Account type and tools → Switch to professional account**.

### 2. Create a business portfolio and add your Instagram account

1. Go to https://business.facebook.com and create a business portfolio, if you don't have one.
2. In the portfolio, open **Settings → Accounts → Instagram accounts**.
3. Click **Add**, then log in to your Instagram account to connect it.

### 3. Create the Meta app, owned by the business portfolio

1. Go to https://developers.facebook.com/apps and click **Create app**.
2. Choose the use case **Manage messaging & content on Instagram**.
3. When asked, select **your business portfolio**.
   - The "API setup with Unified login" tab **only appears for apps owned by a business portfolio**.
   - If you have an existing app without one, connect a business portfolio to it in the App Dashboard first.
4. The app must use **Facebook Login for Business**. New business apps do by default.
5. Copy the app's credentials from **App settings → Basic** into `.env`:
   - **App ID** → `META_APP_ID`
   - **App secret** → `META_APP_SECRET`

   These are the Meta app's credentials, not an Instagram app ID or secret.

### 4. Create the Unified Login configuration

1. In the App Dashboard, go to **Use cases → Manage messaging & content on Instagram → Customize**, then open the **API setup with Unified login** tab.
2. Click **Create new configuration** and set:

   | Setting | Value |
   |---|---|
   | Token type | **System-user access token** |
   | Token expiration | **Never** |
   | Assets | **Instagram account**. Remove the ad account; this app doesn't need it. |
   | Permissions | `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments` |

   - The default configuration also includes `instagram_content_publish`, `ads_management` and `ads_read`. Remove them. Request only what the app uses.
   - Add `pages_show_list` or `business_management` only if the dashboard won't let you save without them.
3. Under **Redirect URL**, enter your callback URL. It must match `META_REDIRECT_URI` exactly:
   ```
   https://your-domain.com/api/instagram/callback
   ```
   Then click **Save**.
4. Copy the configuration's **config ID** into `META_LOGIN_CONFIG_ID`. It isn't a secret; it only identifies the configuration.

- **If Meta reports a redirect URI error at login,** also add the same URL under **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**.
- **HTTPS only:** Meta only accepts HTTPS redirect URLs. For local development, see [Testing locally with HTTPS](#testing-locally-with-https).

### 5. Give your account access while the app is in Development mode

Saving the configuration gives the app **Standard Access**. That's enough for accounts that have a role on the app, so a personal tool doesn't need App Review or Live mode.

1. **You need an admin role on the app.** You have one automatically as the app's creator.
2. **Invite your Instagram account as an Instagram Tester.** On the "API setup with Unified login" page, open **Generate access tokens → Add account**. Alternatively, go to **App roles → Roles → Add People → Instagram Tester**.
3. **Accept the invite on Instagram on the web:** go to **Settings → Website permissions → Apps and websites → Tester Invites**, then click **Accept**.

### 6. Connect

1. Restart the server so it picks up the new env vars.
2. Log in to InstaFlow at the **same host** as `META_REDIRECT_URI`.
3. Open **Settings** and click **Connect Instagram**.
4. Log in with Facebook or Instagram. Then:
   - Choose your **business portfolio**.
   - Choose your **Instagram account**.
   - Approve the permissions.

After you approve, InstaFlow:

1. Exchanges the code for the system-user token, and verifies it with `/debug_token`.
2. Finds your Instagram account ID through `/me/assigned_instagram_accounts`. If that returns nothing, it uses the token's granted assets from `/debug_token` instead.
3. Fetches your username and profile picture.
4. Stores everything, with the token encrypted with AES-256-GCM.

The Settings page then shows the account, token status, expiry ("Never"), business portfolio ID, and granted permissions, with **Test connection** and **Disconnect** buttons.

> **For later steps (DMs):** Instagram only lets apps read messages if you allow it. In the Instagram app, go to **Settings → Messages and story replies → Message controls → Connected tools** and turn on **Allow access to messages**.

### Testing locally with HTTPS

Meta requires HTTPS, so expose your dev server through a tunnel. [ngrok](https://ngrok.com) gives you a free static domain, so the URL doesn't change between runs:

```bash
ngrok http --url=your-name.ngrok-free.app 3000
```

1. Set `META_REDIRECT_URI=https://your-name.ngrok-free.app/api/instagram/callback`, and save the same URL in the login configuration.
2. Restart `npm run dev`. `next.config.ts` automatically trusts the host from `META_REDIRECT_URI` for server actions and dev assets.
3. **Open the app through the tunnel URL, not `localhost`.**
   - The login cookie and the OAuth state cookie belong to the host you're browsing on.
   - If you start on `localhost`, the callback on the tunnel host can't see them, and you'll get a "session expired or didn't match" error.

### Troubleshooting

Every Graph API call goes through `src/lib/instagram.ts`. When a call fails, it logs one line like this:

```
[instagram] GET /oauth/access_token failed: HTTP 400 code=100 subcode=36008 type=OAuthException fbtrace_id=Abc123 | Error validating verification code... | hint: redirect_uri doesn't match the one used for login. Check META_REDIRECT_URI.
```

| What you see | Meaning |
|---|---|
| "Invalid app credentials" (code 101, or 190 with "Error validating application") | `META_APP_ID` or `META_APP_SECRET` is wrong. Use the Meta app's values from App settings → Basic. |
| code `100` subcode `36008` | `META_REDIRECT_URI` doesn't match the redirect URL in the login configuration. |
| code `100` subcode `36007` or `36009` | The login code was invalid or already used. Click Connect again. |
| "No Instagram account was shared during login" | The configuration's asset type isn't Instagram account, or you didn't select your account in the login dialog. |
| `token type is USER, expected SYSTEM_USER` in the logs | The configuration's token type isn't "System-user access token". |
| Login dialog says the app isn't available | Your account has no role on the app, or you haven't accepted the Instagram Tester invite. |
| code `190` | The token no longer works. Reconnect. |
| code `10` or `200`–`299` | A permission is missing from the configuration. |
| code `4`, `17`, `32`, `613`, `80002` | Rate limited. Wait a while. |
| "session expired or didn't match" | You started the connection on a different host than `META_REDIRECT_URI`, or took more than 10 minutes. |

---

## Receiving webhooks

Meta pushes events to `POST /api/webhooks/instagram`. The webhook object type is **`instagram`**, and the app handles three fields:

| Field | What arrives | Shown in Logs as |
|---|---|---|
| `comments` | New comments on your posts | Comment |
| `messages` | DMs, including quick-reply taps (`quick_reply.payload`) | Message / Quick reply |
| `messaging_postbacks` | Icebreaker and button taps (`postback.payload`) | Postback |

### 1. Set the verify token

Run `npm run gen-secrets` and copy `META_WEBHOOK_VERIFY_TOKEN` into `.env`, or into your host's env vars. Then restart the server.

### 2. Enter the callback URL in the App Dashboard

Your callback URL is your app's public HTTPS host plus `/api/webhooks/instagram`. **Settings → Webhooks** shows it ready to copy, for example:

```
https://your-domain.com/api/webhooks/instagram
```

For local development, use your tunnel URL (see [Testing locally with HTTPS](#testing-locally-with-https)). The tunnel must be running when you save.

1. In the App Dashboard, go to **Use cases → Manage messaging & content on Instagram → Customize → API setup with Unified login → Configure webhooks**.
2. Fill in:
   - **Callback URL:** the URL above.
   - **Verify token:** exactly the value of `META_WEBHOOK_VERIFY_TOKEN`.
3. Click **Verify and save**. Meta sends a `GET` handshake (`hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`). The app checks the token and echoes the challenge, and the server log shows `[webhooks] verification handshake succeeded`.
4. In the field list below, **Subscribe** to `comments`, `messages` and `messaging_postbacks`.

### 3. Subscribe your Instagram account

Saving fields in the dashboard is only half of it. Your Instagram account must also be subscribed to the app.

- **Automatic on connect:** InstaFlow does this right after you connect, with `POST /{ig-account-id}/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks` and the system-user token.
- **Status:** **Settings → Webhooks** shows each field as ✓ or ✗, when it was last checked, and any error.
- **Resubscribe:** use this after reconnecting, after changing fields, or if events stop arriving.

### 4. Test it

1. **Dashboard test events:** in Configure webhooks, click **Test** next to a field. The event appears on the **Logs** page within 5 seconds.
   - Meta's sample payloads use a dummy account ID, so they show as **Ignored**, with "Event is for another Instagram account". That's expected, and it proves delivery and signature checks work.
2. **Real events:** from a *different* Instagram account, comment on one of your posts and send your account a DM. They should show as **Processed**.

**Requirements for real events:**

- **Messages:** turn on **Allow access to messages** in the Instagram app, under **Settings → Messages and story replies → Message controls → Connected tools**.
- **Comments:** comment notifications require your account to be **public**.
- **App mode and access:** Meta's docs say the app must be **Live** to receive notifications for app users, and the `comments` field needs **Advanced Access**.
  - If dashboard test events arrive but real ones don't, switch the app to **Live** in the App Dashboard. This needs a privacy policy URL.
  - Then check the access level for `instagram_manage_comments` under **App Review → Permissions and features**.

### How events are handled

1. **Signature:** every `POST` is checked against `X-Hub-Signature-256`, an HMAC-SHA256 of the raw body signed with `META_APP_SECRET`. Invalid or missing signatures get `401` and nothing is stored.
2. **Store first, then answer:** each event is saved to the `WebhookEvent` table before the app returns `200`. This is one fast insert. If the database is down, the app returns `5xx` so Meta retries instead of the event being lost.
3. **Deduplication:** each event has an idempotency key: `comment:<id>`, `message:<mid>` or `postback:<mid>`. Meta retries for up to 36 hours, and a redelivery only increments `deliveryCount`, which shows as ×N in Logs.
4. **Loop prevention:** some events are stored as **Ignored** and never handed to automations:
   - your own comment replies,
   - echoes of messages your account sent,
   - events for any other Instagram account.
5. **Async processing:** after the `200` is sent (Next.js `after()`), pending events are processed. For now that means looking up the sender's username and marking the event processed; automations will hook in here.
   - Each event is claimed atomically before it's handled, so overlapping runs never process the same event twice. That matters once replies are sent.

### Webhook troubleshooting

| Symptom | Fix |
|---|---|
| "Verify and save" fails | The verify token doesn't match `META_WEBHOOK_VERIFY_TOKEN`, the server wasn't restarted after setting it, or the URL isn't publicly reachable. Check the server log for `verification handshake rejected`. |
| Log shows `rejected POST with invalid or missing X-Hub-Signature-256` | `META_APP_SECRET` isn't the secret of the app sending the webhooks. Use App settings → Basic → App secret. |
| Settings shows ✗ fields or "Subscribe failed" | Click **Resubscribe**. Error 190 means reconnect; errors 10 or 200 mean a permission is missing from the login configuration. |
| Test events arrive, real ones don't | See the requirements above: Live mode, Advanced Access for comments, Allow access to messages, public account. |
| Events show as Ignored, "another Instagram account" | Dashboard sample payloads, or events for an account other than the connected one. |

---

## Automations

**Automations → New automation** opens the builder. The phone preview on the right updates as you type, using a sample commenter, `@jess.prints`, whose first name is "Jess".

**Active** automations run on real comments. **Simulate comment**, on each automation card and in the editor, runs the flow safely as a dry run (see [Testing a flow safely](#testing-a-flow-safely)).

| Part | What it does |
|---|---|
| **Trigger** | A comment on **any post or reel**, or on **a specific post**. For a specific post, you pick from a grid of your recent media, loaded from `/{ig-account-id}/media`. |
| **Keywords** | Either **any comment**, or a list of keywords (case-insensitive). With **Whole word**, "link" matches "send the link!" but not "linkedin". With **Contains**, it matches anywhere. The **Test a comment** box shows whether a comment would trigger. |
| **Public reply** | Optional. Up to 10 variations; one is picked at random so replies don't look spammy. |
| **Opening DM** | Sent as a **private reply** to the comment: text plus one quick-reply button. |
| **Follow gate** | Optional. If the person doesn't follow you, they get the "not following" message and an "I've followed" button. The app re-checks up to N times (default 3), then gives up. |
| **Delivery** | Your message, then a **link card** with a URL button. Instagram has no "button template", so the card is a generic template: a title plus a `web_url` button. |

**Variables:** `{first_name}` and `{username}` work in every message and button label. Any other `{…}` is rejected, because it would be sent as literal text.

### Instagram limits enforced by the editor

| Field | Limit | If exceeded |
|---|---|---|
| DM text (opening, not-following, delivery) | **1000 bytes** of UTF-8. An emoji counts as 4. | Error (Instagram rejects the message) |
| Quick-reply button label | 20 characters | Warning (Instagram cuts it off) |
| Card title | 80 characters | Error |
| Link button label | 20 characters | Error |
| Public comment reply | 2200 characters | Error |

Counters show the current size and, when variables are used, the worst case with a long name (`≤ N`). Fitting now but possibly overflowing with a long name is a warning.

The same validation code runs live in the editor and again on the server when you save, so invalid automations can't be stored or activated.

---

## How a flow runs

All calls go to `graph.facebook.com/v27.0` with the stored system-user token, and each one carries `appsecret_proof`. The version is the single `GRAPH_API_VERSION` constant in `src/lib/instagram.ts`.

```
comment ──match──▶ TRIGGERED ──opening DM (private reply)──▶ AWAITING_OPT_IN
AWAITING_OPT_IN ──tap──▶ follow gate off, or already following ──▶ DELIVERING ──text + link card──▶ DELIVERED ✅
                     └─▶ not following ──▶ AWAITING_FOLLOW (+ "not following" message)
AWAITING_FOLLOW ──"I've followed"──▶ now following ──▶ DELIVERING
                                  └─▶ still not following ──▶ resend the gate message, or ABANDONED after the max re-checks
```

### 1. Comment received

1. **Pick the automation.** The comment is matched against **active** automations by post and keyword. Only **one** automation handles a comment, because a comment can get only one private reply. When several match:
   - a specific-post automation beats "any post",
   - a keyword automation beats "any comment",
   - and the most recently edited one wins any remaining tie.
2. **Skip repeat commenters.** If this person already has a run for this automation, nothing happens: one run per person per automation. The extra comment is noted on the existing run's timeline.
3. **Reply publicly (optional).** A random variation is posted with `POST /{comment-id}/replies`.
4. **Send the opening DM** as a **private reply**: `POST /{ig-account-id}/messages` with `{"recipient":{"comment_id":…}}`. It includes the quick-reply button, and the run moves to `AWAITING_OPT_IN`.
   - **One message only.** A private reply is a single message, and must be sent within 7 days of the comment. Older comments fail the run with a clear error.
   - **If Instagram rejects the button.** Meta doesn't document quick replies on private replies. If the button is rejected (invalid parameter), nothing was sent, so the text goes out alone. Any text reply from the person then counts as opting in.
   - **Names.** `{first_name}` is "there" at this point. Instagram only shares the profile after the person messages you.

### 2. Opening button tapped

1. **Identify the run.** The quick-reply payload is `IF1:<runId>:OPT_IN`, so the tap is matched to its run. A plain text reply also works, which matters on desktop, where quick replies aren't shown.
2. **Read the profile.** The tap opens the 24-hour messaging window and gives profile consent. `GET /{IGSID}?fields=name,username,is_user_follow_business` fills in the name and the follow status.
3. **Send the next message:**
   - Follow gate off, or already following → the delivery message, then the link card, then the run is marked `COMPLETED`.
   - Not following → the "not following" message with an "I've followed" button (payload `IF1:<runId>:FOLLOWED`), and the run moves to `AWAITING_FOLLOW`.

### 3. "I've followed" tapped

Follow status is checked again:

- **Following** → the link is delivered.
- **Still not following** → the gate message is sent again.
- **Out of re-checks** → after the automation's max re-checks, the run is marked `ABANDONED` and nothing more is sent.

With a max of 3, someone who never follows gets 3 gate messages in total.

### Safety rules

- **Taps:** stale or duplicate taps are ignored and logged, with no API calls. Examples: tapping an old button after delivery, or tapping twice.
- **Concurrency:** step changes use compare-and-set, so two quick taps can't both advance a run.
- **Retries:** every job sends at most **one** message, so a retry never double-sends.
- **Contacts** are upserted on every interaction: username, name, follow status, and last seen.

### Job queue

Webhook handling only **enqueues** jobs in the `Job` table, so it never times out. The work is done by a worker.

- **Human-like delay:** each DM is scheduled 2–6 s after the previous step.
- **Retries:** network errors, Meta 5xx, Meta's temporary codes 1 and 2, and rate-limit codes **4, 17, 32, 613** (plus Instagram's **80002**) are retried with exponential backoff and jitter. Backoff starts at 15 s, or 60 s for rate limits. It's capped at 1 h, with up to 6 attempts.
- **Permanent errors** fail the run immediately with Meta's error code. Examples: a bad token (190) or a missing permission (10, 200–299).
- **Idempotent and parallel-safe:** jobs have keys such as `opening:<runId>`, so they can't be enqueued twice. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, and a job whose worker crashed is picked up again after 5 minutes.

**Who runs the jobs:**

| Host | Worker |
|---|---|
| Any | After each webhook, the handler keeps working for up to ~25 s (Next.js `after()`), so the first steps of a flow complete right away. |
| Railway / `next start` / `next dev` | An in-process poller, started from `src/instrumentation.ts`, checks every 5 s. Disable it with `JOB_POLLER=off`. |
| Vercel (serverless, no long-running process) | Call `GET /api/cron/jobs` **every minute** with `Authorization: Bearer $CRON_SECRET`. This handles retries and replies that arrive between webhooks. On **Vercel Pro**, add `{ "path": "/api/cron/jobs", "schedule": "* * * * *" }` to `vercel.json`. On **Hobby**, crons can only run daily, so use an external pinger such as cron-job.org. |

### Timeline and stats

- **Timeline:** every step, API request, retry and Meta error is written to `FlowRunEvent`. **Logs → Flow runs** shows each run; click a run to see its timeline.
- **Dashboard:** shows today and the last 7 days: comments matched, DMs sent, follow-gated, links delivered, and conversion (delivered ÷ matched). "Today" starts at midnight in `APP_TIMEZONE`, which defaults to `UTC`; set it to an IANA name such as `Europe/London`.
- **Contacts:** everyone who interacted, searchable by username, name or ID, with their follow status and the automations they've run.

### Data model

| Table | Purpose |
|---|---|
| `Automation` | The flow definition. `active` decides whether it runs. |
| `Contact` | One row per person: Instagram-scoped ID, username, name, first and last seen, `followsMe` (null = never checked), `followCheckedAt`. |
| `FlowRun` | One run per person per automation: a unique key on (`automationId`, `contactId`). Holds the comment, step (`TRIGGERED`, `AWAITING_OPT_IN`, `AWAITING_FOLLOW`, `DELIVERING`, `DELIVERED`), status (`ACTIVE`, `COMPLETED`, `ABANDONED`, `FAILED`), the follow-check count, a timestamp for each step, and the last error. |
| `FlowRunEvent` | The timeline entries for each run. |
| `Job` | The queue: type, payload, idempotency key, status, `runAt`, attempts and last error. |

**List stats** (simulated runs excluded):

| Stat | Counts |
|---|---|
| Triggered | All runs |
| DMs sent | Runs with `openingSentAt` set |
| Follow-gated | Runs with `followGatedAt` set |
| Completed | Runs with status `COMPLETED` |

### Testing a flow safely

**Simulate comment** feeds a fake comment into the **real engine code**, using a fake messenger and an in-memory queue with no delays.

1. **Choose a scenario:** the comment, the commenter, and a follow scenario: already follows, follows after one or two reminders, or never follows.
2. **The commenter is played automatically.** The simulation taps each button the run waits for until the run finishes.
3. **You see the result:** the outcome, the timeline, and the **exact API requests** that would have been sent.

**No Instagram API calls are made.** Simulated runs and contacts are flagged and kept out of stats, the dashboard and Contacts. They appear in Logs with a **Simulated** badge.

It always simulates the **saved** version of the automation, and works on paused automations too.

### Unit tests

```bash
npm test
```

The tests use Node's built-in test runner, run through `tsx`. They cover:

- keyword matching,
- automation validation,
- the flow state machine: every path, plus stale, duplicate and out-of-order taps,
- quick-reply payloads,
- automation priority,
- message payloads,
- retry and backoff policy,
- the 7-day private-reply window.

---

## Token health check (cron)

The system-user token doesn't expire, so there's no refresh job. It can still stop working, for example if:

- the app is removed from your business portfolio (**Business settings → Integrations → Connected apps**), or
- the Instagram account is moved to another portfolio.

`GET /api/cron/health` calls `/debug_token`. The token is marked **invalid** if Meta reports it invalid or expired, or if your Instagram account is no longer among the token's granted assets.

- **Banner:** while the token is invalid, every page shows a **red banner** linking to Settings to reconnect.
- **Auth:** the route skips the session check and requires `CRON_SECRET` in one of these headers:
  - `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends automatically.
  - `x-cron-secret: <CRON_SECRET>`.
- **Response:** JSON with `status`. The HTTP code is chosen so a scheduler's alerts fire on problems:

  | `status` | HTTP | Meaning |
  |---|---|---|
  | `valid` | 200 | Token works. |
  | `no_account` | 200 | No Instagram account connected. |
  | `invalid` | 502 | Token no longer works. The red banner is shown. |
  | `unknown` | 503 | Couldn't verify (network, rate limit, wrong app credentials). The stored status is left as it was. |

- **Test connection:** the Settings button runs the same check, then fetches your live profile.
- **Vercel:** `vercel.json` runs the check daily at 06:00 UTC. Set `CRON_SECRET` in the project's env vars and Vercel attaches it.
- **Railway or anything else:** call it daily from any scheduler:
  ```bash
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/health
  ```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server. |
| `npm run build` | Runs `prisma generate`, then builds for production. |
| `npm start` | Serves the production build. |
| `npm run typecheck` | Type-checks the project without emitting files. |
| `npm test` | Runs the unit tests (keyword matching, flow state machine, validation). |
| `npm run hash-password` | Prints a bcrypt hash for `APP_PASSWORD_HASH`. |
| `npm run gen-secrets` | Prints random `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, and `META_WEBHOOK_VERIFY_TOKEN` values. |
| `npm run db:migrate` | Creates and applies migrations, then regenerates the client (development). |
| `npm run db:deploy` | Applies existing migrations (production). |
| `npm run db:studio` | Opens Prisma Studio. |
| `npm run build:standalone` | Builds a self-contained server bundle in `.next/standalone` (`BASE_PATH`, `PUBLIC_URL` env). |
| `npm run deploy` | Tests, builds, migrates and deploys to a VPS over SSH, with automatic rollback. Settings come from `.deploy.env` (see [Your own server](#your-own-server-vps-optionally-under-a-sub-path)). |

---

## How auth works

- **Login** (`src/app/login`): a single password field. A server action checks the password against `APP_PASSWORD_HASH` with bcrypt.
- **Session:** an HS256-signed JWT in the `instaflow_session` cookie. The cookie is `httpOnly`, `SameSite=Lax`, lasts 30 days, and is `Secure` in production.
- **Route protection** (`src/proxy.ts`, which Next.js 16 calls "proxy" instead of "middleware"):
  - Every route requires a session except `/login`, `/api/webhooks/*` (public for Meta), and `/api/cron/*` (checked with `CRON_SECRET`).
  - Signed-out page requests redirect to `/login?from=...`. Signed-out `/api/*` requests get a `401` response.
  - The dashboard layout and every server action check the session again.
- **Rate limit** (`src/lib/rate-limit.ts`): 5 failed attempts per IP per 15 minutes, stored in Postgres so the limit holds across serverless instances.
- **Logout:** clears the cookie. To force every device to log out, rotate `SESSION_SECRET`.

## How the Instagram connection is secured

- **OAuth `state`:** a random value stored in a short-lived httpOnly cookie that only the callback path can read. The callback rejects any response where the state doesn't match (CSRF protection).
- **Callback:** `/api/instagram/callback` requires your session.
- **Token checks:**
  - The token is verified with `/debug_token`, which confirms it's valid and was issued for your app, before anything is stored.
  - Every Graph call made with the token includes `appsecret_proof`, an HMAC of the token signed with the app secret. Without the secret, a leaked token can't be used against your app.
- **Token storage:** the token is encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`, with a random IV per write. The ciphertext is tied to its purpose (AAD), so it can't be decrypted as anything else.
  - The plaintext token is never logged, never sent to the browser, and never rendered.
- **Disconnect:** deletes the stored token. To also revoke access on Meta's side, remove the app in your business portfolio under **Business settings → Integrations → Connected apps**.

---

## Deploying

Both platforms need the same env vars as `.env`. Paste `APP_PASSWORD_HASH` **raw (unescaped)** in the dashboard.

Set `META_REDIRECT_URI` to `https://<your-production-domain>/api/instagram/callback`, and save that URL in the login configuration too.

**Vercel**

1. Import the repo and add the env vars, including `CRON_SECRET`.
2. Apply migrations by running `npm run db:deploy` locally against the production database. Alternatively, set the build command to `npm run db:deploy && npm run build`.
3. The health-check cron in `vercel.json` is picked up automatically.
4. **Job worker:** call `/api/cron/jobs` every minute. On Pro, add it to `vercel.json`; on Hobby, use an external pinger. See [Job queue](#job-queue).

**Railway**

1. Add the env vars.
2. Build command: `npm run build`.
3. Start command: `npm start`.
4. Pre-deploy command: `npm run db:deploy`.
5. Add a daily cron that calls `/api/cron/health` (see [Token health check](#token-health-check-cron)).
6. **Job worker:** jobs are handled by the in-process poller automatically, so no cron is needed.

### Your own server (VPS), optionally under a sub-path

The app can be served from a sub-path such as `https://example.com/instaflow`.

- **Set at build time:** `NEXT_PUBLIC_BASE_PATH=/instaflow`.
- **Handled for you:** links, redirects, cookie paths, API calls and the URLs shown in Settings all include it.
- **Cookie scope:** the session cookie is scoped to the sub-path, so other apps on the same domain never receive it.

**One-time setup on the server.** These steps match a typical Ubuntu box with Docker, Apache or nginx, and Node 22+.

1. **A system user:**
   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin instaflow
   ```
2. **PostgreSQL.** Bind it to localhost only:
   ```bash
   docker run -d --name instaflow-postgres --restart unless-stopped \
     -e POSTGRES_USER=instaflow -e POSTGRES_DB=instaflow -e POSTGRES_PASSWORD=<random> \
     -v instaflow-pgdata:/var/lib/postgresql/data -p 127.0.0.1:5433:5432 postgres:16-alpine
   ```
3. **The env file** at `/etc/instaflow/instaflow.env`, mode `600`, owned by root. **Single-quote every value**, so the `$` signs in the bcrypt hash are taken literally. Use the **raw** hash, not the `\$`-escaped one:
   ```
   DATABASE_URL='postgresql://instaflow:<password>@127.0.0.1:5433/instaflow'
   APP_PASSWORD_HASH='$2b$12$...'
   SESSION_SECRET='...'
   TOKEN_ENCRYPTION_KEY='...'
   CRON_SECRET='...'
   META_WEBHOOK_VERIFY_TOKEN='...'
   META_REDIRECT_URI='https://example.com/instaflow/api/instagram/callback'
   ```
4. **A systemd unit** `instaflow.service`:
   - `User=instaflow`
   - `WorkingDirectory=/var/www/instaflow`
   - `Environment=PORT=3200 HOSTNAME=127.0.0.1 NODE_ENV=production`
   - `EnvironmentFile=/etc/instaflow/instaflow.env`
   - `ExecStart=/path/to/node server.js`
   - `ReadWritePaths=/var/www/instaflow/.next/cache`, plus the usual hardening (`ProtectSystem=strict` and so on).
5. **The reverse proxy.** Keep the sub-path on both sides.
   - Apache:
     ```apache
     ProxyPreserveHost On
     ProxyPass /instaflow http://127.0.0.1:3200/instaflow
     ProxyPassReverse /instaflow http://127.0.0.1:3200/instaflow
     ```
   - nginx: `location /instaflow { proxy_pass http://127.0.0.1:3200; proxy_set_header Host $host; proxy_set_header X-Forwarded-Host $host; proxy_set_header X-Forwarded-Proto $scheme; }`
   - **HTTPS:** terminate it at the proxy or CDN. Redirects use `X-Forwarded-Host` and `X-Forwarded-Proto`.
6. **The daily health check** in `/etc/cron.d/instaflow`:
   ```
   0 6 * * * root . /etc/instaflow/instaflow.env && curl -fsS -o /dev/null -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3200/instaflow/api/cron/health
   ```
   Flow jobs need no cron, because the in-process poller handles them.

**Deploying (and redeploying)** from your machine. Once:

1. Set up key-based SSH to the server (`ssh-copy-id root@<server>`), so deploys never ask for a password.
2. Copy `.deploy.env.example` to `.deploy.env` (git-ignored) and fill in `DEPLOY_HOST`, `PUBLIC_URL` and `BASE_PATH`.

Then, every time:

```bash
npm run deploy
```

It works on macOS, Linux and Windows (via Git Bash, found automatically). The command:

1. Checks it can reach the server over SSH and that the service and env file exist.
2. Runs the typecheck and unit tests, and stops if either fails.
3. Builds a standalone bundle with `npm run build:standalone`. Any `.env` is stripped from it, and Turbopack's symlinked packages are copied as real folders so a bundle built on Windows runs on Linux.
4. Applies any pending database migrations through an SSH tunnel. With nothing pending, this does nothing.
5. Uploads the bundle and swaps it in atomically. The previous release is kept as `/var/www/instaflow.prev`.
6. Restarts the service and health-checks it, **rolling back automatically** if it doesn't come up.

Flags: `npm run deploy -- --skip-checks` skips step 2, and `--skip-migrate` skips step 4. Environment variables override `.deploy.env`.

**Changing the login password on the server:**

1. Run `npm run hash-password` locally and copy the **raw** hash.
2. On the server, set `APP_PASSWORD_HASH='<raw hash>'` in the env file.
3. Run `systemctl restart instaflow`.

**Meta settings** when running under a sub-path:

- OAuth redirect URL: `https://example.com/instaflow/api/instagram/callback`
- Webhook callback URL: `https://example.com/instaflow/api/webhooks/instagram`

Settings → Webhooks shows the exact URL to copy.

---

## Project structure

```
prisma/
  schema.prisma          # LoginAttempt, InstagramAccount, WebhookEvent, Automation, Contact, FlowRun, FlowRunEvent, Job
  migrations/
prisma.config.ts         # Prisma CLI config (DB URLs for migrations)
vercel.json              # daily token health-check cron
scripts/
  hash-password.mjs
  gen-secrets.mjs
src/
  proxy.ts               # route protection
  lib/
    session.ts           # JWT sign/verify (used by proxy + server)
    auth.ts              # cookie helpers, requireAuth, password hash loading
    rate-limit.ts        # Postgres-backed login rate limiter
    db.ts                # Prisma client (pg driver adapter)
    crypto.ts            # AES-256-GCM encrypt/decrypt, constant-time compare
    instagram.ts         # typed Graph API client (GRAPH_API_VERSION), Meta error handling
    instagram-account.ts # connect, token storage, health check, test, disconnect
    instagram-oauth.ts   # OAuth state cookie constants
    automations/
      schema.ts          # shared types, Instagram limits, variables, validation, keyword matching
      store.ts           # list (with run stats), save, toggle, delete
    flow/
      machine.ts         # PURE state machine, matching, payloads, messages, retry policy (unit-tested)
      engine.ts          # step handlers: comment, public reply, opening DM, taps, delivery
      jobs.ts            # DB job queue: enqueue, claim (SKIP LOCKED), retry/backoff, drain
      messenger.ts       # Graph messenger + dry-run messenger
      simulate.ts        # “Simulate comment” driver
      poller.ts          # in-process job poller (started by src/instrumentation.ts)
      queries.ts         # Logs runs, dashboard funnel, contacts search
    webhooks/
      signature.ts       # X-Hub-Signature-256 verification
      parse.ts           # webhook body → events (idempotency keys, own-activity detection)
      store.ts           # dedup insert, claim-based async processing, Logs query
  app/
    login/               # login page, form, login/logout server actions
    (dashboard)/         # authenticated shell + red "access lost" banner
      settings/          # Instagram connect / test / disconnect / webhook resubscribe
      page.tsx           # dashboard: today / 7-day funnel
      logs/              # flow runs (timelines) + webhook events, polling every 5s
      contacts/          # searchable contacts table
      automations/       # list + stats, editor, simulate dialog, actions
    api/
      instagram/callback/   # OAuth redirect target
      instagram/media/      # recent posts/reels for the media picker (session)
      webhooks/instagram/   # Meta webhook endpoint (public, signature-verified)
      events/, runs/        # Logs page data (session)
      cron/health/          # daily token health check (CRON_SECRET)
      cron/jobs/            # job worker for serverless hosts (CRON_SECRET)
  instrumentation.ts     # starts the in-process job poller on long-running servers
  components/            # sidebar, logo, page header, timeline, useNow
```

## License

[MIT](LICENSE)
