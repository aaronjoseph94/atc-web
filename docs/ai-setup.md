# AI and AirNav: set-up for the site owner

The app works with none of this. Two optional extras are switched on by putting
a secret into Cloudflare:

| Secret | What it switches on | Cost |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` and/or `OPENROUTER_API_KEY` | The AI features: radio calls cleaned up and explained before they are shown, airport briefings, flight stories, weather in plain words. They run on Claude Haiku 5.5 unless you pick Sonnet (below) | You pay your AI provider per request. Capped per day (below). |
| `AIRNAV_ODAPI_TOKEN` | A last-resort lookup of a flight's route and aircraft when the free sources know neither. Needs the KV namespace (section 3) as well | AirNav credits. Capped at 3 a day and 90 in total by default (below). |
| `TURNSTILE_SECRET_KEY` (+ the variable `TURNSTILE_SITE_KEY`) | An invisible browser check before anything that costs money, so scripts cannot use the site as a free AI or speech-to-text service (section 4) | Free |

Keys live **only** in Cloudflare. Nothing is typed into the app, and no browser
ever holds or sends a key. (Earlier versions had key fields in Settings; a key
saved that way is deleted from the browser the next time the app opens.)

## 0. Before anything else: spending limits at the provider

Every check in this app can be weakened by someone determined enough. The
limits your AI provider enforces cannot. Set them first:

- **Anthropic:** in the Console (<https://console.anthropic.com>) put the key
  in its own **workspace** for this site, and give that workspace a **spend
  limit** (Settings → Workspaces → the workspace → Limits). Also check the
  organisation-wide limit under Settings → Limits.
- **OpenRouter:** when creating the key (<https://openrouter.ai> → Keys),
  give it a **credit limit**. A key with a limit stops when the limit is used,
  whatever the app does.

Pick an amount you would not mind losing in a bad month; the daily cap below
keeps normal use far under it.

## 1. Turn the AI features on

### In the Cloudflare dashboard

1. Open <https://dash.cloudflare.com> and choose your account.
2. **Workers & Pages** → **atc-web**.
3. **Settings** → **Variables and Secrets** → **Add**.
4. Type: **Secret**. Name: `ANTHROPIC_API_KEY`. Value: your key from
   <https://console.anthropic.com> → API keys (it starts with `sk-ant-`).
5. Add it to **Production**, then switch the environment picker at the top of
   the Settings page to **Preview** and add it there too (previews are the
   per-branch test sites; skip this if you don't want AI on them).
6. **Save**, then redeploy: **Deployments** → the latest deployment → **⋯** →
   **Retry deployment** (or push any commit). A secret only reaches
   deployments made after it was saved.

### Or from a terminal

```bash
npx wrangler login                      # once
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name atc-web
# paste the key when asked
npm run deploy                          # or push a commit
```

This sets the secret for Production. For the per-branch preview sites, add it
in the dashboard as in step 5 above.

### Check that it worked

Open the site → menu → **Settings**. Under **AI** it should read
`AI: on (Claude Haiku 5.5)`, and **Set up in Cloudflare** should show
**Claude** lit. If it reads `AI is not set up`, the deployment you are looking
at was made before the secret was saved: redeploy.
`https://<your-site>/api/ai` shows the same as JSON: `configured`, which
`providers` have a key (`true`/`false` only), the model that answers, and
today's usage. It never shows a key.

### Adding OpenRouter (as well, or instead)

1. Get a key at <https://openrouter.ai> → **Keys** → **Create key** (it starts
   with `sk-or-`). Give it a credit limit there (see section 0).
2. Add it exactly as in steps 3–6 above, with the name `OPENROUTER_API_KEY`
   (or `npx wrangler pages secret put OPENROUTER_API_KEY --project-name atc-web`),
   and redeploy.
3. **Settings → AI → Set up in Cloudflare** now shows **OpenRouter** lit.

With only the OpenRouter key, everything runs through OpenRouter. With both
keys, Claude's own API is used unless `AI_PROVIDER` or the provider picker
(next section) says otherwise. OpenRouter is sent the same models under its
own names: `anthropic/claude-haiku-5.5` and `anthropic/claude-sonnet-5.5`.

### Choosing the model and provider in the app

**Settings → AI** has:

- **Model**: **Haiku** (Claude Haiku 5.5, the default: fast and cheap) or
  **Sonnet** (Claude Sonnet 5.5: more careful, about 20 times the price per
  request). Opus is not offered and cannot be requested.
- **Provider** (only shown when both keys are set): **Claude** (Anthropic's
  own API), **OpenRouter**, or **Auto** (Claude's API).

Until you pick, the site defaults are used (`AI_MODEL`, `AI_PROVIDER`, below).
The pick is remembered in that browser only, and sent with each AI request
(headers `x-atc-ai-model` and `x-atc-ai-provider`; never a key). The server
only accepts `claude-haiku-5-5` or `claude-sonnet-5-5` (or
`anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`); anything else
is ignored and the site default used, so no visitor can choose a more
expensive model. Any visitor can pick Sonnet for their own device, though: if
you want everyone on Haiku, keep an eye on the daily cap (section 3) and your
provider's spending limit. Cached answers are kept per model, so switching
never shows an answer from the other one.

## 2. Optional settings

All of these are plain text. The simplest place for them is the same
**Variables and Secrets** page, added as secrets like the key. (This project is
configured by `wrangler.toml`, so Cloudflare takes plain *variables* from a
`[vars]` section in that file rather than from the dashboard; secrets are
always set in the dashboard or with `wrangler pages secret put`. Either way
works for these.)

| Name | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `auto` | The site's default provider when both keys are set: `anthropic`, `openrouter`, or `auto` (Claude's API when its key is set, else OpenRouter). A device's pick in Settings overrides it |
| `AI_MODEL` | `claude-haiku-5-5` | The site's default model: `claude-haiku-5-5` or `claude-sonnet-5-5` (the OpenRouter spellings `anthropic/claude-haiku-5.5` / `anthropic/claude-sonnet-5.5` work too). Anything else, Opus included, means Haiku. A device's pick in Settings overrides it |
| `AI_DAILY_CAP` | `3000` | Most AI requests the whole site makes in one day (UTC). `0` switches AI off without removing the key |
| `AI_TASK_CAPS` | `radioCleanup` gets 70% of the daily cap | Per-feature daily caps, e.g. `radioCleanup=1500,flightStory=300` |
| `AI_RATE_BURST` | `20` | Requests one visitor may make in any ten seconds |
| `AI_RATE_PER_MIN` | `60` | Requests one visitor may make in any minute |
| `TRANSCRIBE_DAILY_CAP` | `2000` | Most live-radio transcriptions (Whisper on Workers AI, `/api/transcribe`) the whole site makes in one day (UTC). Past it, transcripts pause until midnight UTC and the radio keeps playing. `0` switches transcripts off. Counted where the AI cap is counted (KV when bound) |
| `TURNSTILE_SITE_KEY` | not set | The public site key of the Turnstile widget (section 4). Only takes effect together with the secret `TURNSTILE_SECRET_KEY` |
| `SESSION_SECRET` | derived from `TURNSTILE_SECRET_KEY` | Optional secret that signs the short-lived session tokens of the browser check. Set it (any long random string) if you want to rotate it separately; changing it signs everyone out of the check once, which the app redoes invisibly |

## 3. What protects your bill

Every visitor's AI request is paid for with your key, so `/api/ai` checks, in
this order:

1. **Same site only.** The request must come from a page of the site it is
   sent to (the browser's `Origin` / `Referer` / `Sec-Fetch-Site` headers).
   Other websites and plain scripts get `403`. A determined person can forge
   these headers from their own machine, which is what the next ones are for.
2. **The browser check, if you turned it on** (section 4): a valid session
   token from Cloudflare Turnstile, or `401`.
3. **Per-visitor rate limit**, by IP address (an IPv6 visitor by its whole
   `/64` network, since one home can use any address in it): a short burst and
   a per-minute ceiling (`AI_RATE_BURST`, `AI_RATE_PER_MIN`). Over it: `429`,
   try again in a few seconds.
4. **A daily cap for the whole site** (`AI_DAILY_CAP`), counted per UTC day.
   The radio clean-up, which is asked once per transmission, has its own
   smaller cap so it cannot use up the allowance the other features need.
   Over it: `429 AI daily limit reached` until midnight UTC.

At the cap the app carries on without AI: radio calls are shown as heard
with a small "unprocessed" mark, the other features fall back to their
built-in text, and visitors see one quiet notice. Nothing breaks.

Answers to identical questions are cached at Cloudflare's edge (per feature,
from minutes to a day) and **cached answers are free: they are not counted
against the cap** and not rate limited.

The flight summary (`/api/summarize`) goes through the same steps (and falls
back to its built-in text instead of answering `429`). Live radio transcripts
(`/api/transcribe`, Whisper on your Cloudflare account) need the same site and
the browser check too, are rate limited per visitor, and stop at
`TRANSCRIBE_DAILY_CAP` a day.

Today's count and the cap are shown in the app under **Settings → Data and
diagnostics**, and at `/api/ai`.

### Where the count is kept, and making the cap firm (recommended)

Out of the box the counters live in Cloudflare's Cache API, which needs no
set-up but has two weaknesses:

- **It is per data centre.** Visitors near Chicago and visitors near London
  are counted separately, each against the full cap. With visitors spread over
  N data centres the real ceiling is up to N × the cap.
- **Cloudflare may drop cache entries at any time**, which resets that data
  centre's count for the day.

So without more set-up the cap is a strong brake, not an exact limit, and
**the AirNav lookups (section 5) stay off altogether**: with only 100
credits, a count each data centre keeps for itself is not good enough. To make
it one count for the whole world, give the project a KV namespace:

1. Create it: **Storage & Databases** → **KV** → **Create** → name it
   `atc-web-counters`, and copy its **ID**. Or:
   `npx wrangler kv namespace create atc-web-counters` (prints the id).
2. Bind it. Because the project has a `wrangler.toml`, bindings are read from
   that file. Uncomment the block at the bottom of `wrangler.toml` and put the
   id in:

   ```toml
   [[kv_namespaces]]
   binding = "AI_KV"
   id = "<the namespace id>"
   ```

3. Commit and deploy. **Settings → Data and diagnostics** then says
   "Counted in Cloudflare KV, all regions", and `/api/health` reports
   `"storage": "kv"` (with `"active": true` for AirNav once its token is set).
   Until then the AirNav line there ends "paused until a KV namespace is
   bound".

Bindings are per environment: with the block in `wrangler.toml`, Production
and the preview sites both use it. If you would rather keep previews apart,
create a second namespace and see Cloudflare's docs on
`[[env.preview.kv_namespaces]]`.

(The block is left commented out in the repository on purpose: a binding with
a made-up id makes deployments fail.)

KV's free plan allows 1,000 writes and 100,000 reads a day. To stay inside
that, each data centre writes its AI count to KV once every ten requests, so
the worldwide count can run a few requests behind. The AirNav counters are
written every time (they change a few times a day at most).

And set the **spending limits from section 0**: they are the one limit that
cannot be got around.

## 4. Optional: a browser check (Cloudflare Turnstile)

The same-site check stops other websites, but a script can pretend to be the
site. Turnstile, Cloudflare's free and usually invisible CAPTCHA replacement,
closes that gap: when it is on, a page first proves it is a real browser, gets
a session token that is good for 30 minutes on that network, and sends it with
every request that costs money (`/api/ai`, `/api/summarize`,
`/api/transcribe`, and the AirNav lookup). Visitors normally see nothing; now
and then Cloudflare may show a small "verify you are human" box in the
bottom-right corner. Without it switched on, nothing changes.

1. **Create the widget.** <https://dash.cloudflare.com> → **Turnstile** →
   **Add widget** (or **Add site**). Name it `atc-web`, add the hostname
   `atc-web-62t.pages.dev` (and your own domain, if you add one later), and
   choose the widget mode **Managed** (or **Invisible**). Create it, and copy
   the **Site Key** and the **Secret Key** it shows. Preview sites
   (`<branch>.atc-web-62t.pages.dev`) are subdomains of that hostname; if the
   check fails on one, add its hostname to the widget too.
2. **Add the keys to the project** (Workers & Pages → atc-web → Settings →
   Variables and Secrets, for Production and, if you want it there too,
   Preview):
   - `TURNSTILE_SITE_KEY`: the site key. It is public (every visitor's browser
     receives it), so it may be a plain variable. Because this project is
     configured by `wrangler.toml`, plain variables come from a `[vars]`
     section there (`[vars]` then `TURNSTILE_SITE_KEY = "0x4AAAA…"`); adding it
     in the dashboard as type **Secret** works just as well.
   - `TURNSTILE_SECRET_KEY`: the secret key, type **Secret**
     (`npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name atc-web`).
   - Optionally `SESSION_SECRET`: any long random string, type **Secret**
     (e.g. from `openssl rand -base64 32`). Without it a key derived from
     `TURNSTILE_SECRET_KEY` signs the session tokens.
3. **Redeploy** (Deployments → latest → ⋯ → Retry deployment, or push a
   commit).
4. **Check:** `https://atc-web-62t.pages.dev/api/session` should answer
   `{"required":true,"siteKey":"0x4AAAA…"}` (the public key only). Open the
   site with radio and AI on: transcripts and AI answers appear as before.

The check is on only while **both** keys are set. To switch it off, delete
either one and redeploy. Session tokens are bound to the visitor's network
(an IPv4 address, or an IPv6 /64): a phone moving from Wi-Fi to mobile data
simply gets a new one, invisibly.

## 5. AirNav Radar as a last resort for flight details

When someone opens a flight and the free sources (adsbdb, hexdb, the ADS-B
feeds) know neither its route nor its aircraft, the server may ask AirNav
Radar's On-Demand API once, for that flight.

### Turn it on

Add the secret `AIRNAV_ODAPI_TOKEN` (your ODAPI token from
<https://www.airnavradar.com> → API) exactly as in section 1, or:

```bash
npx wrangler pages secret put AIRNAV_ODAPI_TOKEN --project-name atc-web
```

and redeploy. Then bind the KV namespace from section 3 if you have not:
**without it no credit is ever spent** (with only 100 credits, the count must
not depend on a cache each data centre keeps, and can forget, on its own).
With the browser check (section 4) on, a lookup also needs a valid session.

### How the credits are protected

- Only when a person opens a flight on the site (the request is marked and
  must come from the site's own pages). Never from the traffic polling, the
  health check, the dev server or the tests.
- Only when the free sources returned no route, or no registration and type.
- One request per flight, never retried. The answer is remembered (route 6
  hours, aircraft 7 days), and so is "AirNav doesn't know either" (1 day), so
  the same flight is not paid for twice.
- `AIRNAV_DAILY_CAP` (default `3` credits a day, UTC) and `AIRNAV_TOTAL_CAP`
  (default `90` credits ever; it cannot be set above `AIRNAV_CREDITS`, default
  `100`). Both are checked before the request is made.
- A rejected token, an empty account or a "slow down" answer stops all
  lookups for a day (an hour for "slow down" and for other refusals).
- Besides the credit caps there is a ceiling on requests a day (five times
  the daily credit cap, at least 10), so answers that cost nothing are not
  asked for without end either.

**Settings → Data and diagnostics** shows
`AirNav credits used: N of 100 (today N of 3)`; `/api/health` has the same
numbers. They are the app's own tally (AirNav is never asked for them): what
each answer said it cost, plus one credit for any request that got no answer
at all, to err on the side of spending less. To compare with AirNav's own
figure, look at your account on airnavradar.com.

To start the tally again (say, after buying credits): delete the keys
`airnav:total` and `airnav:day:<date>` from the KV namespace (dashboard → KV →
the namespace → KV Pairs), and raise `AIRNAV_CREDITS` / `AIRNAV_TOTAL_CAP`.

### What has been checked, and what has not

- **Checked against AirNav's published OpenAPI document** (version 2.4.22):
  the address (`https://api.airnavradar.com/v2/flights/live`), the bearer
  token, the request (`modeSHexCodes` / `flightIds`) and the fields read from
  the answer.
- **Checked against the live service, without spending anything:** one request
  with a made-up token. It answered `200` with `success: false`, `cost: 0`
  and a comment saying the token was not recognised; the code treats exactly
  that as "stop asking for a day".
- **Not checked: a successful lookup.** That needs your token and a credit.
  The first real one is the test: open a flight that shows no route, then
  look at the diagnostics line and the flight's details.
- **Not known: how many credits one lookup costs.** AirNav's documents don't
  say. Each answer reports its own cost; the app counts that, remembers it,
  and leaves room for it before the next lookup. If one lookup turns out to
  cost more than 3 credits, raise `AIRNAV_DAILY_CAP` or nothing more will be
  asked.
- Without the KV namespace nothing is asked at all (the caps would be per data
  centre and could be forgotten by the cache, as in section 3).

## 6. Removing or changing a key

Edit or delete the secret on the same **Variables and Secrets** page (or
`npx wrangler pages secret delete NAME --project-name atc-web`) and redeploy.
Without the key the app goes back to working without AI at once.

## 7. Local development

`npm run dev` reads the same names from your shell, never from a file in the
repository:

```bash
ANTHROPIC_API_KEY=sk-ant-… OPENROUTER_API_KEY=sk-or-… npm run dev
```

Counters are kept in memory and start again when the dev server restarts. The
AirNav lookup is not available in the dev server at all, so local work cannot
spend credits.

To try the browser check locally, use Cloudflare's published Turnstile test
keys, which always pass and spend nothing:

```bash
TURNSTILE_SITE_KEY=1x00000000000000000000AA \
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA npm run dev
```
