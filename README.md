# Mindline

A 10-minute self check-in of memory, attention and processing speed that tracks change against the user's **own baseline** over repeated sessions.

**Status:** prototype. Not a medical device, not a diagnostic tool, not clinically validated.

## How it works
- Five tasks: word learning, reaction time, symbol–digit coding, alternating trail (1-A-2-B…), delayed recall. All are original implementations of standard research paradigms, not licensed instruments (MoCA, MMSE, etc.).
- First check-in is practice; the next two form the baseline. Later results are flagged when they fall below the baseline mean by more than max(1.5 SD, a per-task floor).
- Sessions taken while sick, short on sleep, or interrupted are saved but excluded from the baseline.

## Privacy
Single static page. No backend, no accounts, no analytics. Results live in the browser's `localStorage` for this site's origin only. A Content-Security-Policy blocks all network requests; fonts are self-hosted.

Note: `localStorage` is tied to the origin, so changing the domain resets everyone's history (users can back up and restore from the "Your data" page).

## Hosting
GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.

## Fonts
Atkinson Hyperlegible and Literata, both SIL Open Font License 1.1 (see `fonts/`).
