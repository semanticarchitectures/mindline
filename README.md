# Mindline

A 10-minute self check-in of memory, attention and processing speed that tracks change against the user's **own baseline** over repeated sessions.

**Status:** prototype. Not a medical device, not a diagnostic tool, not clinically validated.

## How it works
- Five tasks: word learning, reaction time, symbol–digit coding, alternating trail (1-A-2-B…), delayed recall. All are original implementations of standard research paradigms, not licensed instruments (MoCA, MMSE, etc.).
- First check-in is practice; the next two form the baseline. Later results are flagged when they fall below the baseline mean by more than max(1.5 SD, a per-task floor).
- Sessions taken while sick, short on sleep, or interrupted are saved but excluded from the baseline.

## Voice assistant (demo)
An optional AI assistant (Claude) talks with the person before the tasks. It asks how they're feeling, how they slept, whether they have concerns about their memory or thinking, and whether anyone has noticed changes. It also answers questions about the check-in, about each task (an "Ask a question" button on every task screen), and about the results screen. What the person tells it is saved with the check-in in their own words, under "What you told the assistant".

It is told never to diagnose, never to judge how the person seems, and never to give medical advice. If someone mentions possible stroke symptoms, thoughts of suicide, or being harmed by someone, it pauses the check-in and shows 911, 988 or the Eldercare Locator. The page also scans the person's words for those phrases and shows the same contacts even if the model doesn't.

Voice in and out uses the browser's Web Speech API (Chrome, Edge, Safari; Firefox falls back to typing). The person can also say their recall words aloud instead of typing them. Whether recall was typed or spoken is saved per check-in, because switching modes can change scores.

**Setup:** open the Assistant tab and choose one of:
- **API key**: paste an Anthropic API key. It's sent only from the browser to `api.anthropic.com` and kept for the tab session unless "Remember" is checked. Good for a presenter's own laptop. Use a key with a low spending limit.
- **Demo proxy**: deploy `worker/` to Cloudflare Workers so the key never reaches the page:
  ```
  cd worker
  npx wrangler secret put ANTHROPIC_API_KEY
  npx wrangler secret put DEMO_PASSCODE
  npx wrangler deploy
  ```
  Then enter the worker URL and passcode on the Assistant tab. Set `ALLOWED_ORIGIN` in `wrangler.toml` to wherever the page is served. The page's Content-Security-Policy allows `*.workers.dev`; add your host to `connect-src` if the proxy is on a custom domain.

## Privacy
Single static page, no accounts, no analytics. Results live in the browser's `localStorage` for this site's origin only. Fonts are self-hosted. With voice features turned off, the page makes no network requests. With the assistant on, conversation text (and on the results screen, today's results) goes to the Anthropic API, and Chrome/Edge send microphone audio to Google/Microsoft for speech recognition. This is fine for a demo; a real deployment would need a privacy review.

Note: `localStorage` is tied to the origin, so changing the domain resets everyone's history (users can back up and restore from the "Your data" page).

## Hosting
GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.

## Fonts
Atkinson Hyperlegible and Literata, both SIL Open Font License 1.1 (see `fonts/`).
