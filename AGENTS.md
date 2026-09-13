# Glint — decisions and agent handoff

## User intent and precedence

Build a useful Firefox highlighter that persists across reloads and dynamically rendered conversations. Keep RAM consumption and shipped code low. Preserve the core features below when changing implementation details. The user has explicitly chosen a plain JavaScript and CSS sidebar. New explicit user instructions take precedence over this record.

Ask questions through the Spokenly MCP `ask_user_dictation` tool, as the user uses voice input. Never infer that an interrupted dependency-install approval succeeded.

## UI implementation decision

Svelte is not required for any feature. Native DOM APIs, CSS, WebExtension APIs and CSS Custom Highlights cover the entire feature set.

The sidebar uses plain JavaScript modules and CSS. This is a confirmed user decision. Do not introduce Svelte, another UI framework, or a framework-specific build tool without explicit user approval recorded here.

Svelte offers useful declarative templates, keyed list updates, reactive state and lifecycle cleanup. Its compiler produces optimized JavaScript, but this does not mean all runtime support or reactive state costs disappear. The compiler and development dependencies are not themselves loaded into Firefox. `node_modules` size, extension package size and live browser RAM are distinct metrics. These facts motivated the review; they do not replace the user's confirmed implementation decision.

The native sidebar is in `src/sidebar.js` and its stylesheet is `public/sidebar.css`. The content script and background script remain framework-free. The build invokes esbuild only, then copies the manifest, stylesheets and sidebar HTML into the extension root. Sidebar lifecycle should be measured rather than assuming that closing its UI immediately releases every allocation.

No production bundle size or RAM comparison has been measured. Do not quote a numerical saving or call the existing implementation memory-efficient without profiling it. A careful native implementation can avoid framework machinery; a native implementation that continually rebuilds the entire DOM can still perform poorly.

## Core features: preserve this order and behavior

1. Select text and show a small floating colour palette near the selection. Support a default yellow highlight through Alt+Shift+H and a selection context-menu action. Preserve keyboard accessibility and exclude editable controls.
2. Persist semantic anchors: exact text, prefix, suffix, start/end text offsets, URL/conversation identity, stable message identity where available, colour and optional note. Never use DOM nodes or XPath as the primary persisted anchor.
3. Restore anchors automatically into DOM Ranges on reload. Render using CSS Custom Highlights on Firefox 140+. Do not wrap or rewrite application text nodes.
4. Restore after lazy loading, streaming and DOM replacement using MutationObserver. Identify affected messages and resolve only relevant annotations. Handle conversation navigation without requiring a full page reload.
5. Provide a plain JavaScript and CSS sidebar with current-conversation highlights first, jump to passage, edit colour, delete and notes. Unloaded or changed text must produce an honest unresolved status.
6. Keep a shared engine with GenericAdapter and provider adapters for ChatGPT, Claude, Gemini and DeepSeek. Providers supply identity and DOM scope; do not fork persistence, anchoring and rendering into separate provider implementations.

Local browser storage remains the implementation. On 2026-09-11 the user requested desktop Chromium support and cross-device access, including exporting to a notes app, and confirmed using a Mac and iPhone. This authorizes work toward portability/sync beyond the original local-only scope. The first implementation adds manual text/Markdown export and Glint JSON transfer. Automatic sync, a cloud destination and any native Apple Notes bridge remain undecided and unimplemented. No analytics, server, AI service or remote scripts have been added.

## Current implementation, not completion claims

The original workspace was empty. The scaffold now contains:

| Files | Responsibility |
| --- | --- |
| `public/manifest.json`, `public/highlights.css` | Firefox MV3 manifest, commands, sidebar and range colours |
| `src/anchors.js` | Text indexing, quote/context ranking and range reconstruction |
| `src/adapters.js`, `src/identity-migration.js` | Generic/provider identity and DOM adapters; versioned canonical identity migration |
| `src/content.js` | Palette, selection capture, restoration, observer and highlight registry |
| `src/storage.js`, `src/background.js` | Conversation storage keys, serialized mutations and browser events |
| `src/sidebar.js`, `sidebar.html`, `public/sidebar.css` | Native DOM sidebar and stylesheet |
| `scripts/build.js`, `package.json` | esbuild-only bundle and static asset copy |
| `tests/anchors.test.js` | Initial anchor tests using jsdom |
| `README.md` | Loading and manual acceptance instructions |

Dependencies and a lockfile are now present. `npm test`, `npm run check` and `npm run build` pass, including a DOM integration test for create/recolour/remove and registry updates. `dist` contains the built extension. Live Zen/Firefox acceptance and RAM profiling remain outstanding. Do not equate DOM tests with browser-extension integration verification.

## Panel and editing behavior

Manual recovery (0.3.0): **Link saved highlights to this page** in the popup/sidebar lazily loads saved-conversation summaries, previews exact/context matches on the current HTTP(S) page, and requires explicit confirmation. It copies all source records into the destination with new IDs, page scope and `recovery: { conversation, id }` provenance; originals remain unchanged and edits are independent. Missing/ambiguous passages remain unresolved. Recovery ignores source offsets and message IDs when matching, reuses one temporary page index, and preserves conservative matching on reload and DOM replacement. It skips already-linked copies by source conversation/ID. This is not a permanent URL alias or sync rule.

The serialized background handler restricts recovery requests to Glint's sidebar/popup, checks the target tab URL and live page identity, and compares source SHA-256 revision, document nonce and match results again before confirmation. Preview state lives only in the UI; no global cache, polling or remote calls were added. Source changes, reload/navigation and changed match results require a new preview. Normal storage failures remain visible. Copies can be removed with ordinary controls; the original survives. Version 2 JSON backups retain recovery provenance; old version 1 backups are still accepted. Exports without recovered records remain version 1, while old Glint releases reject version 2 rather than lose recovery matching semantics.

The toolbar opens `sidebar.html?popup`, a temporary browser action popup, by default. The persistent sidebar is optional through an explicit **Open sidebar** button; its **Close sidebar** button calls the browser API directly from a user click. The manifest sets `open_at_install: false`. Do not make highlighting open a persistent panel. Browser popups dismiss when focus leaves them; the extension does not control Zen's own tab strip/sidebar chrome. A sidebar left open in a previous version must be closed once by the user. Firefox requires a user action for `sidebarAction.close`, so do not implement automatic background calls on arbitrary tab/focus events as if they were supported.

Click a highlight, or reselect overlapping text, to show colour and **Remove highlight** controls. Changes apply to all annotations intersecting the selected text or clicked range rectangles, including old overlapping duplicates. Colour choices update these annotations instead of creating another one. Successful writes explicitly reload the page's annotation ranges; the library UI also refreshes after a successful mutation. Missing annotation IDs now surface an error. This implements removal, not a general undo/redo history. Errors from storage must remain visible.

After a rebuild, reload the temporary extension and existing web pages so the new content script replaces the old one. Existing stored records remain compatible.

## Memory and performance findings to address

These are source-review findings, not measured rankings by memory cost:

- Addressed for the default sidebar view: reads only the current conversation, renders 25 cards initially with explicit batches, and creates editors on demand. Saved websites uses a summary index, built once on demand in the background from existing records without modifying them. Other conversation rows load on expansion and are released on collapse. The summary list itself is not paginated; profile extremely large libraries before claiming bounded total memory.
- Sidebar tab listeners filter active-tab URL/load changes; storage listeners filter the current conversation and visible library keys. Current refreshes coalesce. Existing card DOM and note drafts survive refreshes; DOM tests cover focused note selection. Library refreshes use obsolete-result guards but could be coalesced further under heavy writes.
- `content.js` observes the whole body immediately on every eligible page, including pages with no saved annotations. Activate restoration observation when relevant annotations exist; retain lightweight selection and storage/navigation hooks so the first highlight still works.
- Addressed in 0.3.4: mutation scheduling runs 150 ms after the first queued change, without resetting during streaming, and disconnected queued roots are pruned. The duration of a large batch is not yet bounded; chunking and profiling remain outstanding.
- `resolveAnchor` still rebuilds a text-node index per ordinary identified/page annotation. Anonymous-message restoration in 0.3.4 shares one temporary index per candidate root, released after processing that root. Extend reuse to the remaining paths; avoid persistent copies of entire conversation text or long-lived text-node indexes.
- Keep only current-conversation metadata in a content script and only valid ranges for loaded passages. Explicitly clean up selected ranges, removed-node references, dirty roots and registered highlights on navigation/teardown. Check actual range behavior during removal; checking `isConnected` alone does not establish that a live Range still covers the original quotation.
- Avoid rebuilding all colour registries on unrelated changes. Skip no-op batches and update affected colours when practical.
- Preserve MV3 event-driven background behavior; do not add keepalive loops, polling or a global in-memory annotation cache. Verify persistence and write completion across background suspension.

## Correctness risks still needing verification

- Provider selectors have not been tested on current signed-in ChatGPT, Claude, Gemini or DeepSeek pages. Stable IDs are used only where exposed. Addressed in 0.3.4: ID-less message annotations are resolved together across loaded message roots, requiring a unique exact quote plus full saved prefix/suffix; offsets do not choose between messages. Identical matching contexts stay unresolved. This conservative fallback can also leave changed context unresolved and must scan loaded candidate roots on mutation; profile large conversations. Unloaded indistinguishable occurrences cannot be detected without stable identity.
- Conversation changes can race pending loads or saves. Verify identity at save time, clear stale ranges promptly and reject obsolete restoration work.
- Cross-message anchors use page scope. Page-scope fallback scans can be costly on long conversations.
- Restoration currently requires exact quotation text. Whitespace or textual changes can leave a highlight unresolved; do not silently attach it elsewhere.
- Clicking an item from another conversation currently opens its URL but does not schedule a jump after that page loads. Complete that flow if promising jump-to-passage across conversations.
- Native sidebar retains safe text rendering and uses keyed card DOM updates. DOM tests now cover focus, caret and unsaved notes during automatic refresh, plus untrusted titles. Live keyboard, screen-reader and popup colour-picker checks remain pending.

## Continuation instructions

1. Read this file and inspect actual files; distinguish recommendations from implemented behavior. Do not restart the project or overwrite unrelated work.
2. Keep the sidebar in small native DOM-rendering modules and CSS. Retain its features and storage records. Do not add a UI framework by default.
3. Address bounded sidebar data/rendering and observer/index lifecycle work above. Prefer straightforward modules over inventing a custom reactive framework.
4. Install dependencies with the environment's required permissions, create a lockfile, build and run the relevant checks. Do not describe tests as passing merely because their files exist.
5. Test Firefox loading, highlighting, persistence, editing and provider navigation. Document failures and remaining limitations honestly.
6. Record completed changes, commands/results and any user-approved decision changes in this file. Keep README consistent with the implementation. Do not silently change the core scope.

## Verification and measurement protocol

Use a clean Firefox profile with the version and OS recorded. Compare identical pages and annotation data with the extension disabled and enabled. If measuring a framework comparison, build both variants in production mode with equivalent behavior; report raw/minified shipped bytes separately from RAM.

Exercise: no annotations and sidebar closed; one conversation with 100 highlights; a library of 1,000 highlights with only one conversation loaded; 1 versus 10 open tabs; sidebar opened/closed repeatedly; repeated navigation; and message removal/reinsertion during continuous streaming. Record loaded message counts and quote/note sizes so results are reproducible.

Use Firefox `about:memory` reports/diffs for browser memory attribution and the Firefox Profiler for CPU activity during idle and mutation bursts. Apply the same garbage-collection procedure and waiting period to both runs. Repeat samples and report variation. Browser process RSS alone is noisy and is not a precise extension allocation measurement.

Acceptance: all core interactions work; no background polling; no full-library load/render for the default sidebar view; bounded restoration batches; no monotonically retained detached message trees across repeated cycles after collection. Set numeric RAM/latency budgets after a baseline is recorded rather than inventing guarantees now.

## Research sources

Reviewed 2026-09-10; these support platform/framework facts, not application-specific RAM estimates.

- [Svelte overview](https://svelte.dev/docs/svelte/overview): compiler and optimized generated JavaScript; supports its developer-experience benefit, not a zero-runtime-cost claim.
- [Svelte state](https://svelte.dev/docs/svelte/$state): reactive state semantics used by the existing sidebar.
- [MDN background manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background): background lifecycle and MV3 non-persistent behavior.
- [MDN background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts): event-driven background implementation.
- [Firefox about:memory documentation](https://firefox-source-docs.mozilla.org/performance/memory/about_colon_memory.html): collecting and comparing memory reports.
- [MDN MutationObserver.disconnect](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect): stopping observation when no longer needed.

## Change log

- 2026-09-13: Fixed reproduced Gemini-shaped ID-less message restoration overwrites in 0.3.4. Anonymous records now require one unique exact quote/full saved-context match across loaded message roots, with one temporary index per root and no offset tie-breaking or storage migration. Missing/ambiguous matches are cleared. Captured selections and rendered/editable ranges are validated against their text (preserving excluded-text anchor semantics); changed selections report an explicit retry instead of silently failing, and unresolved saves are reported honestly. Mutation scheduling no longer resets during streaming and prunes disconnected queued roots; large batch duration remains unbounded. Added five DOM regression tests for repeated passages, independent add/delete, replacement/removal/reinsertion, ambiguity, stale save/recolour selections, continuous streaming and excluded text. All 28 tests, `npm run check`, `npm run package` and `git diff --check` passed. Final installed Helium / Chromium 153.0.8010.36 smoke passed creation/restoration/editing, transfer/deletion, identity migration and recovery using an isolated profile on macOS. Built and verified unsigned `glint-0.3.4-firefox.xpi` and `glint-0.3.4-chromium.zip`; no upload. Current signed-in Gemini/Zen acceptance and RAM profiling remain outstanding; the stale-selection mechanism is reproduced but not confirmed as the cause of the user's missed clicks.

- 2026-09-13: Final 0.3.3 verification: all 23 tests, syntax and diff checks passed. `npm run package` built and verified `glint-0.3.3-firefox.xpi` and `glint-0.3.3-chromium.zip`. No signing or upload performed.

- 2026-09-13: Follow-up legibility request supersedes background-only foreground preservation for ordinary highlights: solid backgrounds now use contrasting black/white text, retaining typography. Recognised PDF text layers explicitly retain transparent text with 40% backgrounds and existing canvas-scoped blending. Added saved-colour deletion in the page palette and sidebar management controls; serialized deletion changes only the saved palette, validates hex input, preserves annotations and surfaces write failures. Applying a deleted colour again saves it again. Installed Chromium 153.0.8010.36 smoke checks passed, including computed foreground colours on a black/white page, PDF transparency and deletion without changing annotations. Prepared version 0.3.3; live Zen/provider PDF acceptance remains outstanding.

- 2026-09-13: `npm run package` created and verified `glint-0.3.2-firefox.xpi` and `glint-0.3.2-chromium.zip`; final syntax and diff checks passed. Packages remain unsigned and were not uploaded.

- 2026-09-13: Added solid preset/custom backgrounds for ordinary text so dark page backgrounds do not dilute selected colours; retained 40% opacity on recognised PDF.js/React-PDF text layers and existing canvas-scoped multiply blending. Foreground colour and typography remain untouched. Custom colours are automatically remembered with successful save/recolour writes, deduplicated by lowercase hex and offered in the page palette and sidebar across conversations. A one-time lazy scan collects older custom colours; saved colours survive annotation deletion, remain local to the profile and are not transferred in JSON backups. No polling or framework added. Version 0.3.2: all 23 automated tests and syntax checks passed; installed Helium/Chromium 153.0.8010.36 smoke checks passed, including computed solid custom/preset backgrounds on black and translucent PDF styles. The smoke check now waits for restored dynamic styles after reload. Live Zen, signed-in ChatGPT PDF visual acceptance and RAM profiling remain outstanding.

- 2026-09-11: Added provider-independent manual recovery as 0.3.0. Added shared conservative quote matching, original-preserving copies, a lazy native UI with 25-row preview batches, confirmation revalidation, current-page recovery status updates and compatible version 2 backups. `npm test` passed all 22 tests; syntax/build checks passed. Installed Helium 0.16.6.1 / Chromium 152.0.7977.82 on macOS 14.8.9 passed generic recovery UI preview/confirmation, original preservation, reload restoration and independent deletion alongside the existing smoke checks. Packaging now reads the version automatically and verifies an explicit set of runtime files byte-for-byte, excluding stale archives in build folders. Firefox installed acceptance, current signed-in providers and RAM profiling remain outstanding.

- 2026-09-10: Created the initial unverified extension scaffold with a Svelte sidebar.
- 2026-09-10: Reviewed Svelte against the user's memory priority; recommended a native sidebar, identified independent data/observer costs, and added this handoff. No framework migration or measured performance results yet.
- 2026-09-10: User confirmed the native JavaScript/CSS direction. Replaced the Svelte sidebar with `src/sidebar.js`, added `public/sidebar.css`, and changed the build to esbuild only. Removed Svelte, Vite, svelte-check and `src/Sidebar.svelte`. Build and browser verification remain outstanding.
- 2026-09-10: Made the toolbar a temporary popup with optional sidebar open/close controls; disabled sidebar opening on install. Added direct page recolour/removal, updates instead of duplicate highlights, explicit refresh after mutations and missing-record errors. Installed dependencies and built `dist`; anchor and page-editing tests and syntax checks pass. Live Zen testing remains pending.

- 2026-09-11: Added eight preset colours and validated six-digit custom colours across persistence, CSS Highlight rendering, the page palette and sidebar. Custom CSS rules are limited to active custom colours and removed when unused; text colour uses luminance contrast. Replaced the circular × control with a separate labelled Remove highlight row and a centred SVG trash icon. Palette placement measures its dimensions; custom colour has explicit Apply and hex validation. Stale page palette edits are rejected after conversation changes.
- 2026-09-11: Reworked the native sidebar into `sidebar.js` and `sidebar-ui.js`: current website/conversation first; expandable website → conversation → highlight hierarchy; counts, compact quotes, on-demand editors, explicit Save note, light/dark styles and focus/draft preservation. Default reads are conversation-only, cards expand in batches of 25, and a serialized on-demand library summary migration preserves old annotation records. Other-page quotes explicitly open their page; cross-page automatic passage jumps remain unimplemented. Closing the panel discards unsaved drafts.
- 2026-09-11: `npm test` passed 8 tests covering anchors, page edits/custom-colour registration and cleanup, colour validation/contrast, index migration/write/delete, sidebar lazy loading and draft/focus preservation. `npm run check`, `npm run build`, and `git diff --check` passed. Used sample-data screenshots in headless Zen 1.22b on macOS 14.8.9 to inspect compact and expanded sidebar layouts plus the custom-colour palette and aligned removal icon. Installed-extension acceptance, native picker behaviour on live pages, signed-in providers and RAM profiling remain outstanding; observer/index lifecycle findings above are not addressed by this UI change. Existing untracked `persistent-highlighter.xpi` was left untouched; use the rebuilt `dist` for this version.

- 2026-09-11: Rebuilt and replaced `persistent-highlighter.xpi` at the user’s request with the latest UI. Bumped manifest, package and lockfile versions to 0.1.1. `npm run build` passed; verified ZIP integrity, all seven root-level extension files byte-for-byte against `dist`, and matching versions. Package is unsigned; no external upload or signing was performed.

- 2026-09-11: Continued the naming request with Glint after the user asked to proceed following a cancelled voice clarification. Renamed the manifest, toolbar/sidebar titles, panel branding, HTML title, npm package and README; added the tagline “Keep what catches your eye.” Bumped version to 0.1.2 and built `glint.xpi`; retained the previous `persistent-highlighter.xpi`. Preserved the Firefox extension ID `persistent-highlighter@local` and storage format for update continuity. `npm test` passed all 8 tests; `npm run check`, `npm run build` and `git diff --check` passed. Verified ZIP integrity and all seven package files byte-for-byte against `dist`, plus branding/version and unchanged extension ID. Live browser update acceptance remains pending; no upload, signing, name-availability check or RAM profiling was performed.
- 2026-09-11: Added the requested desktop Chromium build and cross-device reading/transfer path. `dist` remains the Firefox build; `dist-chromium` uses a service worker and Chromium `sidePanel` manifest while sharing the content, storage and sidebar engine. Added an Export & transfer page with Apple Notes text, Markdown and validated Glint JSON backup/import. Imports are manual, additive by highlight ID, preserve local edits and do not synchronize edits/deletions. Added 13 automated tests and an isolated Chromium smoke test. `npm test`, `npm run check`, `npm run build`, `npm run package`, `git diff --check` and Helium 0.16.6.1 / Chromium 152.0.7977.82 smoke acceptance pass. Apple Notes/iCloud import, Firefox installed-update acceptance, Safari/iPhone highlighting, signed-in provider pages, background suspension and RAM profiling remain outstanding. Automatic cross-browser sync is not implemented.
- 2026-09-11: Released the identity compatibility work as 0.2.1. Canonicalized recognized conversation URLs by provider plus stable conversation ID, covering ChatGPT `/c/`, Claude `/chat/`, Gemini `/app/` and DeepSeek `/a/chat/s/`, while retaining URL identities for generic and unrecognized routes. Added a one-time, write-before-remove migration for prior URL-based records, canonical-key conflict precedence, original/latest URL tracking and the same normalization for imported backups. This addresses renamed ChatGPT project slugs without platform-specific storage forks. Automated identity, migration and import coverage plus an installed Chromium old/new project-slug smoke scenario pass; current signed-in provider DOM/URL acceptance remains outstanding.

- 2026-09-12: Changed preset and custom page highlights to background-only styling at the user’s request, removing forced foreground colours. Palette/control contrast remains unchanged. Updated the existing custom-highlight assertion and README appearance checks. `npm test` passed all 22 tests; `npm run check`, `npm run build` and `git diff --check` passed. Both build directories are refreshed; release archives were not repackaged. The reported apparent widening and bold/italic changes have not been reproduced in a live browser; visual Firefox/provider acceptance remains outstanding.

- 2026-09-12: Follow-up after the user reported invisible text in ChatGPT’s PDF preview in Zen: changed all preset/custom page backgrounds to 40% opacity, retaining original foreground styling. The previous opaque background could obscure canvas-rendered PDF text beneath transparent text layers; PDF.js upstream CSS confirms this layered rendering pattern, but ChatGPT’s actual implementation has not been inspected. Updated the existing custom-colour assertion and README. All 22 tests, syntax checks, builds, package verification and diff checks pass. Rebuilt `glint-0.3.0-firefox.xpi` and `glint-0.3.0-chromium.zip`. Live Zen/ChatGPT PDF visual verification remains outstanding; no claim of reproduced or verified PDF rendering.

- 2026-09-12: User reports PDF formatting is now resolved but colours/text look faded. Replaced the eight pastel preset RGB values with saturated colours in both shared swatches and page CSS, retaining 40% opacity and untouched foreground styling to avoid further obscuring PDF artwork. Existing named presets adopt the new colours; custom hex choices remain as saved. README updated. All 22 tests, syntax checks, build/package verification and diff checks pass; Firefox/Chromium archives rebuilt. Visual prominence and PDF text contrast in live Zen remain unverified.

- 2026-09-12: Addressed PDF lettering losing contrast with a scoped multiply-blend marker on recognised canvas-backed PDF.js/React-PDF text layers containing active Glint ranges. Shared rendering/persistence remains intact; no text wrapping, geometry overlays or polling. Markers are released on range removal, detached layers, navigation and pagehide, and restored on back/forward cache pageshow. Added a lifecycle/scoping regression test and `tests/fixtures/pdf-contrast.html`. All 23 tests, syntax checks, build/package verification and diff checks pass. In an isolated headless Zen 1.22b profile on macOS 14.8.9, the synthetic canvas/text-layer screenshot reproduces faded lettering with the prior alpha-only rendering and visibly black lettering with multiply blending. This is a controlled rendering check, not installed-extension or signed-in ChatGPT preview acceptance. Dark/recoloured PDF pages and alternative viewer structures remain unverified. Rebuilt version 0.3.0 Firefox/Chromium archives.

- 2026-09-12: Prepared the PDF highlight rendering fixes as version 0.3.1. Updated manifest, package and lockfile versions and current README package names. `npm test` passed all 23 tests; `npm run check`, `npm run package` and `git diff --check` passed. Packaging created and verified `glint-0.3.1-firefox.xpi` and `glint-0.3.1-chromium.zip`. The release remains unsigned and has not been uploaded; signed-in ChatGPT PDF preview acceptance remains outstanding.
