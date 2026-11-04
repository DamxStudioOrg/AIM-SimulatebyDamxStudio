# Simulate by Damx Studio

Prompt-arena stewardship simulation: you write one prompt, a model plays it through a crisis, and the run scores you 0–100. Run it free in the desktop app (your models, your keys), climb the live ranks, and propose trials the community votes on.

## What the app can do

* **City crisis (the main game).** One steward prompt pilots a 12-turn city through flood and heatwave shocks on turns 5 and 9. Impact and efficiency score 0–100, with badges, a turn-by-turn verdict, and a retry that keeps your draft.
* **Tote pack-out.** A knapsack packing shift scored on the same 0–100 scale, so city and tote runs compare on one board.
* **Chains and trials.** City and tote alternate down an endless chain with rising cycles; trial codes (`AIM1.…`) import anyone's exact seed into your shared trials.
* **Leagues.** Private tables inside Ranks with invite codes — members' city and tote runs stand together, normalized.
* **Create and dress a challenge.** Propose your own trial; an optional dressing brief spends one model call on moons, scenery, and towers (visual only, never scoring). Ranked bots vote proposals onto the board; drafts simulate before proposing.
* **Your models, your keys.** LM Studio and Ollama connect themselves the moment a runtime answers; hosted `meta/*` models run on one Meta API token, other hosted models on their own keys. Keys stay encrypted on your device, travel only to the sim that plays your turns, and local play needs no keys at all. If the proxy path dies, the console fails over to your local sim directly.
* **Practice that pays.** Prompting drills, a focus picker that reads your record, ghost races against your own past runs, a prompt judge, cost tracking, what-if turn previews, and up-to-three field-plan land moves per run.
* **Runs that survive menus.** Matches and packs run in the background while you browse; an away-from-console popup offers the verdict with one tap back, and closes itself after 7 seconds if ignored.
* **Progress that seals.** No password: a random arena ID minted on-device seals history, leagues, trials, and ratings. Adopt it on another device or export an encrypted transfer bundle; provider keys never leave the device.
* **Desktop extras.** The shell boots its own sim sidecar and console, checks for updates weekly, and sandboxes imported dataset folders (read-only source, runs read the copy) for file-grounded dressing briefs.

## Get the app

Download the macOS (one universal `.dmg` for Apple Silicon and Intel), No account needed — install, open, and play; sign in only when you want ranks and leagues.

## Run it locally

Prereqs: Node 20+, Python 3.13, and (for the live board) PHP 8.3 + Composer. All commands run from this directory.

**1. The sim (terminal 1, required).** The game engine every run plays against.

```sh
python3 -m venv .venv
.venv/bin/pip install -e "app/sim/.[api]"
.venv/bin/python -m uvicorn aim_sim.api:create_app --factory --port 8000
```

Healthy when `http://localhost:8000/contract` answers 200.

**2. The web console (terminal 2, required).**

```sh
cd web && npm install && npm run dev
```

Open `http://localhost:3000/console`. The landing page lives at `/`.

**3. The live board (terminal 3, optional).** Ranks, proposals, votes, and installer links. Skip it and everything still scores locally with an honest "board is down" note.

```sh
cd server && composer install
cp .env.example .env && php artisan key:generate
touch database/database.sqlite && php artisan migrate
php artisan serve --port=8001
```


**Build the macOS installer.**

```sh
cd web && npm run build
cd ../app/sim && ./build-sidecar.sh
cd ../electron && ./vendor-node.sh && npm run dist
```

Output lands in `app/electron/dist-installer/` (`.dmg` + `.zip` today; `nsis`/`AppImage` targets exist but await verification on a Windows/Linux host).


## Workspace
* `web/` – Single Next.js codebase. `/` is the public landing (planet slideshow + download CTA, static moon, no simulation); `/console` + `/api/*` are the full console, used by Electron and gated off public builds.
* `app/electron/` – Electron desktop shell (boots to `/console`).
* `app/sim/` – Python sim API.
* `server/` – Cloud board / auth.


## Branding
Simulate by Damx Studio. Logo: `simulatebydamxstudio.png` (all right reserved for the logo by Damx Studio LTD.) (web copy: `web/public/logo.png`), used for the favicon/tab icon and planet home badge.
