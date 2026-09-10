# Persistent Highlighter — decisions and agent handoff

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
6. Keep a shared engine with GenericAdapter, ChatGPTAdapter, ClaudeAdapter and GeminiAdapter. Providers supply identity and DOM scope; do not fork persistence, anchoring and rendering into separate provider implementations.

Local-only storage is the current scope. No analytics, cloud sync, server, AI service or remote scripts. Do not add those as incidental improvements.

## Current implementation, not completion claims

The original workspace was empty. The scaffold now contains:

| Files | Responsibility |
| --- | --- |
| `public/manifest.json`, `public/highlights.css` | Firefox MV3 manifest, commands, sidebar and range colours |
| `src/anchors.js` | Text indexing, quote/context ranking and range reconstruction |
| `src/adapters.js` | Generic and three provider adapters |
| `src/content.js` | Palette, selection capture, restoration, observer and highlight registry |
| `src/storage.js`, `src/background.js` | Conversation storage keys, serialized mutations and browser events |
| `src/sidebar.js`, `sidebar.html`, `public/sidebar.css` | Native DOM sidebar and stylesheet |
| `scripts/build.js`, `package.json` | esbuild-only bundle and static asset copy |
| `tests/anchors.test.js` | Initial anchor tests using jsdom |
| `README.md` | Loading and manual acceptance instructions |

Dependencies and a lockfile are now present. `npm test`, `npm run check` and `npm run build` pass, including a DOM integration test for create/recolour/remove and registry updates. `dist` contains the built extension. Live Zen/Firefox acceptance and RAM profiling remain outstanding. Do not equate DOM tests with browser-extension integration verification.

## Panel and editing behavior

The toolbar opens `sidebar.html?popup`, a temporary browser action popup, by default. The persistent sidebar is optional through an explicit **Open sidebar** button; its **Close sidebar** button calls the browser API directly from a user click. The manifest sets `open_at_install: false`. Do not make highlighting open a persistent panel. Browser popups dismiss when focus leaves them; the extension does not control Zen's own tab strip/sidebar chrome. A sidebar left open in a previous version must be closed once by the user. Firefox requires a user action for `sidebarAction.close`, so do not implement automatic background calls on arbitrary tab/focus events as if they were supported.

Click a highlight, or reselect overlapping text, to show colour and **Remove highlight** controls. Changes apply to all annotations intersecting the selected text or clicked range rectangles, including old overlapping duplicates. Colour choices update these annotations instead of creating another one. Successful writes explicitly reload the page's annotation ranges; the library UI also refreshes after a successful mutation. Missing annotation IDs now surface an error. This implements removal, not a general undo/redo history. Errors from storage must remain visible.

After a rebuild, reload the temporary extension and existing web pages so the new content script replaces the old one. Existing stored records remain compatible.

## Memory and performance findings to address

These are source-review findings, not measured rankings by memory cost:

- `src/sidebar.js` calls `storage.local.get(null)`, retains the complete annotation library and renders every row, including a textarea for every note. Prefer current-conversation reads, bounded rendering and on-demand access to other conversations. Merely hiding already-created rows is insufficient. If adding an index for conversation summaries, migrate existing storage without dropping annotations.
- Sidebar refresh listeners react to all tab updates and storage changes. Filter for the active tab, relevant URL/load changes and relevant annotation keys; coalesce redundant requests. Preserve unsaved note edits and focus during updates.
- `content.js` observes the whole body immediately on every eligible page, including pages with no saved annotations. Activate restoration observation when relevant annotations exist; retain lightweight selection and storage/navigation hooks so the first highlight still works.
- Debouncing currently waits until mutations stop for 150 ms. Continuous streaming can postpone restoration indefinitely while the dirty-root set grows. Use bounded batches with a maximum delay and remove disconnected queued roots.
- `resolveAnchor` rebuilds a text-node index per annotation. Build one temporary index per affected root per batch and reuse it, then release it. Avoid persistent copies of entire conversation text or long-lived text-node indexes.
- Keep only current-conversation metadata in a content script and only valid ranges for loaded passages. Explicitly clean up selected ranges, removed-node references, dirty roots and registered highlights on navigation/teardown. Check actual range behavior during removal; checking `isConnected` alone does not establish that a live Range still covers the original quotation.
- Avoid rebuilding all colour registries on unrelated changes. Skip no-op batches and update affected colours when practical.
- Preserve MV3 event-driven background behavior; do not add keepalive loops, polling or a global in-memory annotation cache. Verify persistence and write completion across background suspension.

## Correctness risks still needing verification

- Provider selectors have not been tested on current signed-in ChatGPT, Claude or Gemini pages. Stable IDs are used only where exposed. Missing IDs currently share a null-ID candidate bucket, so identical quotations in different messages can restore incorrectly. Improve disambiguation and leave genuinely ambiguous matches unresolved.
- Conversation changes can race pending loads or saves. Verify identity at save time, clear stale ranges promptly and reject obsolete restoration work.
- Cross-message anchors use page scope. Page-scope fallback scans can be costly on long conversations.
- Restoration currently requires exact quotation text. Whitespace or textual changes can leave a highlight unresolved; do not silently attach it elsewhere.
- Clicking an item from another conversation currently opens its URL but does not schedule a jump after that page loads. Complete that flow if promising jump-to-passage across conversations.
- Native sidebar must preserve safe text rendering (`textContent`, not untrusted `innerHTML`), focus, note drafts, accessibility and error feedback. The current renderer uses `textContent`; test focus and unsaved-note behavior during automatic refreshes.

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

- 2026-09-10: Created the initial unverified extension scaffold with a Svelte sidebar.
- 2026-09-10: Reviewed Svelte against the user's memory priority; recommended a native sidebar, identified independent data/observer costs, and added this handoff. No framework migration or measured performance results yet.
- 2026-09-10: User confirmed the native JavaScript/CSS direction. Replaced the Svelte sidebar with `src/sidebar.js`, added `public/sidebar.css`, and changed the build to esbuild only. Removed Svelte, Vite, svelte-check and `src/Sidebar.svelte`. Build and browser verification remain outstanding.
- 2026-09-10: Made the toolbar a temporary popup with optional sidebar open/close controls; disabled sidebar opening on install. Added direct page recolour/removal, updates instead of duplicate highlights, explicit refresh after mutations and missing-record errors. Installed dependencies and built `dist`; anchor and page-editing tests and syntax checks pass. Live Zen testing remains pending.
