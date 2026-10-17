# Millennium Scale

A Yu-Gi-Oh! banlist validator. Feed it a decklist, pick a format and an effective date, and every card that breaks the Forbidden & Limited list turns red with the exact reason and how many copies to cut.

Three pages, cross-linked in both directions:

| Page | What it does |
|---|---|
| `index.html` | **Validate** — drop a `.ydk`, a `ydke://` URI, or deck JSON; checks the F&L list, or the Genesys point cap |
| `lists.html` | **Lists** — browse every banlist and Genesys point list by format and effective date |
| `publish.html` | **Publish** — upload a new list, check it, add it to the archive |

No build step, no framework, no bundler. Plain HTML, CSS and classic `<script>` tags.

---

## The data

`data/banlists.js` ships **populated**: 211 lists, 32,437 entries.

| Format | Lists | Range |
|---|---|---|
| TCG | 79 | May 1st 2002 → May 18th 2026 |
| Master Duel | 51 | Aug 31st 2022 → Jul 1st 2026 |
| OCG | 81 | Feb 2000 → Jul 1st 2026 |

Refresh it whenever a new list drops:

```bash
node tools/fetch-banlists.mjs                      # from the live archive
node tools/fetch-banlists.mjs --from ~/Downloads   # from *CombiList.conf files on disk
node tools/fetch-banlists.mjs --only MD            # one format
node tools/fetch-banlists.mjs --cards              # also bundle card details, for full offline use
```

Each format publishes a combined `*CombiList.conf` holding every list it has ever had, so the live mode is one request per format. Nothing is fetched at page load — the site never re-downloads the archive on its own.

**Quirks the fetcher handles.** Section names are day-first European dates (`TCG 18.05.2026` → `2026-05-18`), and older OCG lists give only a month (`OCG 08.2000` → `2000-08-01`, or the exact advertised day when the index page has one). Occasionally the archive carries two sections for one date where the later is a correction — the more complete one wins, and it says so. Three sections upstream currently have no card entries at all (`MD 31.01.2026`, `MD 21.01.2026`, `OCG 21.12.2025`); those are skipped and reported rather than imported as empty lists that would call every deck legal.

### Genesys points

`data/genesys.js` holds the [Genesys](https://www.yugioh-card.com/en/genesys/) point list: 750 pointed cards as of the 1st Anniversary Update (announced October 5th 2026). Every card not on it costs 0.

```bash
node tools/fetch-genesys.mjs                    # fetch; writes only if any value changed
node tools/fetch-genesys.mjs --date 2026-10-05  # date a new list by its announced effective date
```

Konami's page is the authority, but it lists names, not passcodes, and carries no effective date. So:

- **Names are resolved against YGOPRODeck**, comparing letters and digits only (`Ω7` and `O7` match). The two spellings that differ outright live in `ALIASES` in `tools/lib/genesys.mjs`.
- **YGOPRODeck's own `genesys_points` is the cross-check.** Where they disagree Konami's value is used, and the refresh PR lists every disagreement. A pointed card YGOPRODeck knows but no Konami row resolved to is kept at YGOPRODeck's value and reported, so a spelling change can't quietly make a 100-point card free.
- **History accumulates.** Konami only publishes the current list, so each change is added as a new dated list on top. It's dated the day the change was first seen (`dateSource: "detected"`) unless `--date` gives the announced day (`"announced"`). An unmerged refresh PR keeps its first-seen date rather than moving daily.
- **A broken page isn't a new list.** Fewer than 100 rows, or a near-empty card database, is refused rather than written.

Each list carries the standard 100-point `cap`. Events can set their own, so the validator has a **Point cap** field (remembered per browser; clear it to go back to the list's cap).

**How Genesys validates.** The Forbidden & Limited list doesn't apply: every card is allowed at three. Every copy in the Main, Extra and Side Deck counts toward the cap, and alt-art passcodes cost what the base card does. Link and Pendulum Monsters aren't allowed at all and are flagged individually. Deck sizes are the TCG's. Each tile shows its cost, and the verdict bar shows the total against the cap with how many points to cut.

On the Lists page, Genesys lists group by cost band and compare like banlists do: *Newly pointed*, *Raised*, *Lowered* and *Back to 0* take the place of the status categories.

### Genesys points (OCG)

Japan runs its own Genesys lists, with their own point values. `data/genesys-ocg.js` holds every list [Konami Japan](https://www.yugioh-card.com/japan/howto/genesys/) has issued, each with its announced effective date and **card pool**: a card first distributed in Japan after that list's cutoff can't be used.

```bash
node tools/fetch-genesys-ocg.mjs    # fetch every list; writes only if anything changed
```

- **History comes from Konami.** Each list has its own page and date, so all of them are fetched, and none needs dating by hand. A list that drops off Konami's page stays in the archive.
- **Japanese names are resolved once.** A name is looked up in Konami's card database (name → Konami card id, exact match after folding full-width characters), then mapped to a passcode via YGOPRODeck's `konami_id`. The published data keeps each card's `jaName`, so later runs reuse it and only look up names they've never seen. The first build made about 1,200 lookups at one a second; a normal day makes none.
- **Unplaced names are loud.** A name with no exact match counts as 0 points until fixed, so the refresh PR lists each one with ⚠️. Fix it with an entry in `ALIASES` in `tools/lib/genesys-ocg.mjs`.
- **The card pool is checked.** The validator flags a card whose first Japanese release is after the list's cutoff. A card with no known Japanese release date isn't flagged.

On the Lists page, Genesys (OCG) shows each card's English name, and search also matches the Japanese one.

### Scheduled refresh

`.github/workflows/refresh.yml` re-runs all three fetchers every day at 07:23 UTC (and on demand from the Actions tab). When upstream has changed, it runs the full test suite and link check against the new data, then opens a pull request from `bot/data-refresh` whose description says what moved: new lists with how many cards each changed, upstream corrections, and re-dated lists. Merging that PR is the only human step; the push to `main` deploys it.

The fetcher is built to run unattended:

- **No change, no diff.** It compares what it fetched with `data/banlists.json` and writes nothing when the content matches, so a quiet day leaves the tree clean. A refresh PR that already holds the latest data isn't pushed to again.
- **Outages aren't changes.** If a whole format comes back missing or empty, it refuses to write and the job fails, rather than proposing to delete an archive.
- **Removals are flagged, not hidden.** A list that's gone upstream is refused locally unless you pass `--allow-shrink`. The scheduled job passes it, and marks the removal ⚠️ in the PR for review.
- **Re-dates are recognised.** A month-only section (`2015.07 TCG`) sits on the 1st until the index advertises its exact day. When it moves, the summary reports a re-date, not a removal plus an addition.
- **`--only` is safe.** Fetching one format keeps the others as they were.

```bash
node tools/fetch-banlists.mjs --summary changes.md    # what the bot runs, minus --allow-shrink
```

The workflow needs **Allow GitHub Actions to create and approve pull requests** turned on (*Settings → Actions → General → Workflow permissions*). Without it the branch is still pushed and the run fails with a link to open the PR by hand. GitHub pauses scheduled workflows after 60 days without repository activity; re-enable it from the Actions tab if that happens.

### Scraping the data

Everything the site knows is published as static JSON beside the pages, so other tools can read it without scraping HTML:

| URL | What it is |
|---|---|
| `https://scale.reizu.dev/data/index.json` | A few KB. Each format, its list count and range, the current list's id, date and size, and when each bundle last changed. Poll this one. |
| `https://scale.reizu.dev/data/banlists.json` | The whole banlist archive, schema `millennium-scale/banlists@1`. |
| `https://scale.reizu.dev/data/genesys.json` | Every Genesys point list, schema `millennium-scale/genesys@1`. Same shape, with `points` in place of `status` and a `cap` per list. |
| `https://scale.reizu.dev/data/genesys-ocg.json` | Every OCG (Japan) Genesys list, same schema, plus `cardPool.releasedBy` per list and `jaName` per card. |

`index.json` carries no timestamp of its own and is rebuilt from the bundles, so it changes only when the data does. Compare its `current.id` values, or a bundle's `generated`, to tell whether there's anything new to download.

## Running it

**Locally, no server.** Unzip the project, keep the folder structure intact, and double-click `index.html`. The data bundle is a `<script>` rather than a `fetch()` precisely so this works under `file://`.

The `assets/`, `js/` and `data/` folders must sit next to the HTML files. If they don't, every page shows a red banner naming exactly which files failed to load rather than rendering unstyled.

**Locally, with a server** (nicer URLs, service-worker-friendly):

```bash
python3 -m http.server 8080
# or: npx serve .
```

**Hosted.** It's static — drop the folder on GitHub Pages, Netlify, Cloudflare Pages, S3, anything. No configuration, no environment variables, no backend.

## Card details

Level, Rank, Link rating, ATK/DEF, Attribute, Type, Pendulum Scale, frame type and card text all come from the [YGOPRODeck](https://ygoprodeck.com/) API, looked up by passcode and cached permanently in IndexedDB. Card data never changes once printed, so a card is fetched at most once per browser.

Alt-art passcodes are folded onto the base card. This matters more than it sounds: a banlist entry and a decklist entry routinely use different printings of the same card, and comparing raw passcodes would miss the match.

For a build that never touches the network at all, run the fetcher with `--cards` and add this line before `js/core.js` in each page:

```html
<script src="data/cards.js"></script>
```

## Deck input formats

Passcodes are always shown as 8 characters, zero-padded — `00440556`, not `440556`. The unpadded number is what the API, the image CDN and `.conf` files use, so padding is applied only where a passcode is shown to a person; search accepts either form.

**`.ydk`** — the EDOPro / YGOPro format, `#main` / `#extra` / `!side` with one passcode per line.

**`ydke://`** — base64 little-endian `uint32` arrays, three `!`-separated sections.

**JSON** — the parser is deliberately permissive and accepts all of these:

```jsonc
// the converter's shape — Monsters/Spells/Traps are all Main Deck
{ "Name": "Floo",
  "Monsters": [{ "CardDatabaseId": 20207, "Quantity": 3 }],
  "Spells": [], "Traps": [], "Extra": [], "Side": [] }

{ "main": [{ "id": 23434538, "count": 3 }], "extra": [], "side": [] }
{ "main": [23434538, 23434538], "extra": [], "side": [] }
{ "cards": [{ "id": 23434538, "qty": 3, "section": "main" }] }
{ "deck": { "main": [...], "extra": [...], "side": [...] } }
[23434538, 23434538, 23434538]
```

Section keys are matched case- and punctuation-insensitively: `Monsters`, `Spells`, `Traps` and `Ritual` all mean Main Deck; `Extra`, `ExtraDeck`, `Fusion`, `Synchro`, `Xyz` and `Link` mean Extra Deck; `Side` and `SideDeck` mean Side Deck. For each entry, `id` also matches `CardDatabaseId` / `cardId` / `passcode` / `password` / `konamiId`, and `count` also matches `Quantity` / `qty` / `amount`. Cards given by name instead of an id are resolved against the card database. When a card doesn't say which pile it's in, it's placed by frame type — Fusion, Synchro, Xyz and Link go to the Extra Deck.

### Non-passcode card ids

Some exporters identify cards by something other than the 8-digit passcode. Real passcodes are overwhelmingly six digits or more, so a deck full of four- and five-digit ids is detected automatically and marked as a foreign id space rather than being reported as 72 unknown cards.

Translating them needs a lookup table in `data/idmap.js`. Build one from Konami's own database ids:

```bash
node tools/fetch-banlists.mjs --idmap
```

The validator then says exactly how it went — *"Translated 72 of 72 cards"* — and names any id it couldn't place. If none of them match, it says that too, rather than pretending: that means the ids belong to a different numbering scheme, and the table needs to come from whichever tool exported the deck. The file only needs to be `{ foreignId: passcode }`; swap in your own if Konami ids aren't the right space.

With a map loaded, the validator also offers a **Converter JSON** export that maps back the other way, so decks round-trip.

Exports are available for all three formats from the validator.

## Banlist format

`.conf` files are read in the standard EDOPro LFList format:

```
!2026.05 TCG
#forbidden
23434538 0 --Maxx "C"
#limited
24224830 1 --Called by the Grave
```

Status codes are `0` Forbidden, `1` Limited, `2` Semi-Limited, `3` Unlimited. A `$whitelist` line means anything *not* listed is banned. Combined files with several `!` sections are supported — the Publish page lets you pick which one to import.

The JSON shape is documented at the top of `data/banlists.js`.

## Comparing lists

The archive page has a **Compare with** picker. It defaults to the list immediately before the one you're viewing, but you can point it at any other date in the format — including one 24 years earlier — or turn comparison off.

The summary strip counts what moved: newly listed, tightened, loosened, off the list, unchanged. **Each of those is a toggle** — click one to show only those cards, click more to combine them, click again to switch it off. A *Show all* button appears once anything is selected, and categories with nothing in them are disabled rather than hidden so the counts stay readable. The Status dropdown filters independently and the two intersect, so *Tightened* plus *Forbidden only* gives exactly the cards that were newly banned.

Each changed row carries a `Semi 2 → Lim 1` arrow, and **Diff CSV** exports the whole comparison.

A card missing from a list is Unlimited on it, so "came off the list" and "went to Unlimited" are treated as the same event. Lower status numbers are stricter, so a falling number is a tightening.

**Unreleased vs Unlimited.** A card absent from an old list because it hadn't been printed yet is a different thing from one that was legal at three copies, so those show as `Unrel` rather than `Unlim`, and the change reads *"New card, Forbidden on release"*. This matters most over long spans: diffing 2002 against 2026 turns 218 misleading `Unlim → Forb` rows into accurate ones. The comparison uses the release dates for the region you're browsing, and when a card has no release data at all it falls back to Unlimited rather than guessing.

Because the diff works on any two lists, it also compares *across* formats — point a TCG list at a Master Duel one to see where the two disagree.

### Release dates

The **Released** column shows when each card first became legal, taken from YGOPRODeck's TCG and OCG release dates. It follows the format you're browsing: OCG lists show OCG dates, everything else shows TCG dates and falls back to OCG for cards never printed in the TCG. Master Duel has no separate release data, so those lists show TCG dates.


## Deploying to GitHub Pages

The site is published at **https://scale.reizu.dev** by `.github/workflows/deploy.yml`.

Every pull request and every push runs the tests, assembles the site into `_site/`, and checks that no page references a missing file. A push to `main` then publishes that same `_site/` to Pages. A failing test or a broken reference blocks the deploy.

Pages must be set to **Source: GitHub Actions** (*Settings → Pages*), not "Deploy from a branch". The custom domain is `scale.reizu.dev` with HTTPS enforced; the `CNAME` file in this repo carries it on every deploy, so the setting won't get wiped. The DNS `CNAME` record at the registrar points at the account's `github.io` host.

### What gets published

`index.html`, `lists.html`, `publish.html`, `404.html`, plus `assets/`, `js/`, `data/`, the icons, `site.webmanifest`, `robots.txt` and `sitemap.xml`. `tools/`, `tests/`, `README.md` and `package.json` stay in the repo but aren't served.

`.nojekyll` is included so Pages serves the files as-is rather than running them through Jekyll.

### Checks that run before publishing

`npm test` — 96 tests across 9 suites covering the parsers, validation engine, list diff, bundled archive, deck import, the refresh logic, and the TCG and OCG Genesys point lists and validation.

`npm run build` — copies exactly the published files into `_site/` (`tools/build-site.mjs`), failing if any is missing.

`node tools/check-links.mjs _site` — walks every built page and confirms each local `href`/`src` resolves, that each page links a stylesheet, and that the data bundle isn't empty. This is the check that would have caught the flattened `assets/` folder, and it fails the build rather than shipping a broken page.

Run both locally any time:

```bash
npm test
npm run build && node tools/check-links.mjs _site
```

### Serving it locally

```bash
npm start          # http://localhost:8080
```

Or just double-click `index.html` — it still works straight off disk.

## Card art on hover

Hovering a card name on the archive page shows the card image, positioned to stay on screen and following the cursor. It's keyboard-accessible too — tab to a row and the preview appears on focus. The **Art on hover** switch turns it off, and the setting is remembered.

Clicking a card name opens the detail sheet, which shows the full-size art beside its stats, banlist status and card text. If the image can't load the sheet collapses back to a single column rather than leaving a gap.

Images come from YGOPRODeck's CDN, so both need a connection; without one the hover preview stays hidden and the detail sheet simply drops the art.

## Publishing a list

The Publish page takes a `.conf` or JSON file, then runs it through a set of checks: does it parse, is the effective date real, does a list already exist for that date, are there duplicate passcodes, does every passcode resolve to a real card. It shows a preview grouped by status before anything is saved.

**Publish to this browser** saves it in `localStorage`, where it sits alongside the bundled archive and shows up in the format and date pickers immediately, tagged `local`. Nothing leaves your machine.

**Download `data/banlists.js`** exports the whole archive — bundled plus local — as a drop-in replacement for the data file. Commit that to ship the list to everyone.

## Deck rules by format

| | Side Deck | Traditional | Main | Extra | Side |
|---|---|---|---|---|---|
| TCG | yes | yes | 40–60 | ≤15 | ≤15 |
| OCG | yes | no | 40–60 | ≤15 | ≤15 |
| Master Duel | no | no | 40–60 | ≤15 | — |
| Genesys | yes | no | 40–60 | ≤15 | ≤15 |
| Genesys (OCG) | yes | no | 40–60 | ≤15 | ≤15 |

Copy limits count Main, Extra and Side **together**, per the official rules — three copies split across two piles is still three copies. Traditional format converts Forbidden to Limited rather than removing the card.

The validator also flags cards sitting in the wrong pile (a Link monster in the Main Deck, a Ritual monster in the Extra Deck).

## Design notes

The palette is taken from the game itself: Duel Monsters card-frame colours do the semantic work, so a Spell reads as Spell-green and an Xyz reads as Xyz-black without a legend. Around that sits limestone, gold and lapis rather than a generic accent.

The card tiles are typographic rather than image-based by default — each one is a miniature card frame built from type, with level pips, ATK/DEF and the frame colour as a spine. It's faster, it works offline, and it stays readable at small sizes. There's a **Card art** toggle for when you want to eyeball the real thing.

The signature element is the scale in the verdict bar: it sits level when the deck is legal and tips when it isn't. It respects `prefers-reduced-motion`.

Light and dark are toggled by the sun/moon switch in the header. The choice is written to `localStorage` and read back by an inline script that runs before first paint, so the theme carries across all three pages with no flash on navigation. A `storage` listener also syncs it live between open tabs — flip it on one and the others follow. With nothing stored yet it follows your system setting.

Accessibility floor: visible keyboard focus, `aria-current` on nav and list selection, `aria-pressed` on the toggles, live regions on the status area, and a layout that holds up down to mobile widths.

## File map

```
index.html            validator
lists.html            archive browser
publish.html          upload / verify / publish
404.html              not-found page
CNAME                 scale.reizu.dev
.nojekyll             serve files as-is, no Jekyll
favicon.ico           multi-resolution, 16 to 256px
site.webmanifest      installable-app metadata
robots.txt sitemap.xml
.github/workflows/deploy.yml   test, build, publish
.github/workflows/refresh.yml  daily scrape -> refresh PR
tests/                96 tests, run with npm test
assets/styles.css     design tokens, both themes, all layout
assets/icon.svg       app icon
js/core.js            parsers, card database, validation engine, shared UI
js/validator.js       validator page
js/browse.js          archive page
js/publish.js         publish page
data/banlists.js      the archive (generated, ~1.8 MB / ~250 KB gzipped)
data/banlists.json    the same data, pretty-printed, for other tools
data/genesys.js       Genesys point lists (generated)
data/genesys.json     the same, pretty-printed
data/genesys-ocg.js   OCG (Japan) Genesys point lists (generated)
data/genesys-ocg.json the same, pretty-printed
data/index.json       small manifest of every bundle and format, for polling
data/idmap.js         optional foreign-id -> passcode table (generated with --idmap)
data/cards.js         optional offline card details (generated with --cards)
assets/icons/         PNG set, maskable variants, social card
tools/fetch-banlists.mjs
tools/fetch-genesys.mjs
tools/fetch-genesys-ocg.mjs
tools/lib/            change detection, refresh summary, manifest
tools/data-differs.mjs
tools/build-site.mjs  assembles _site/ for publishing
tools/check-links.mjs
```

## Credits

Banlist data from [ygo.anihelp.co.uk](https://ygo.anihelp.co.uk/). Genesys points from [Konami](https://www.yugioh-card.com/en/genesys/), cross-checked against YGOPRODeck, and from [Konami Japan](https://www.yugioh-card.com/japan/howto/genesys/), with names resolved through Konami's card database. Card data from [YGOPRODeck](https://ygoprodeck.com/). Yu-Gi-Oh! is a trademark of Konami; this is an unaffiliated fan tool.
