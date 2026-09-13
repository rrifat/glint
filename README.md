# Glint

**Keep what catches your eye.**

See [AGENTS.md](AGENTS.md) for the architecture decisions, memory requirements, known gaps and agent handoff. The sidebar uses plain JavaScript and CSS; do not add a UI framework without an explicit, documented need.

A Firefox 140+ and desktop Chromium 116+ extension with a selection palette, Alt+Shift+H, selection context menu, persistent semantic anchors, CSS highlights, and a native JavaScript sidebar with colours and notes. Highlights are stored locally in each browser profile. Export reading copies for Apple Notes or Markdown apps, or use a Glint JSON backup to transfer highlights between browsers. Automatic sync is not implemented.

## Develop and load

1. Run `npm install`, then `npm run build`.
2. Open Firefox `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**, then select `dist/manifest.json`.
4. Open a normal web page, select text, and choose a colour. Click the extension toolbar button to open the temporary highlights popup. Choose **Open sidebar** only when you want a persistent panel; use **Close sidebar** to dismiss it.

For desktop Chromium browsers, open their extensions manager (for example, `chrome://extensions`), enable **Developer mode**, choose **Load unpacked**, and select `dist-chromium`. The build generates a Chromium service-worker manifest and a Firefox background-script manifest from the same source. The popup remains the default. Chromium's optional sidebar uses `sidePanel`; if programmatic close is unavailable (before Chromium 141), use the browser's panel close button. Sidebar support varies among Chromium derivatives; the popup and export page work independently of it.

Installing the Chromium build does not automatically copy Firefox's data. Keep the old installation until you have exported and verified your backup.

## Read highlights on your iPhone

1. In Glint's popup or sidebar, choose **Export & transfer**. It opens a full browser tab so file selection does not dismiss the controls.
2. Choose **All saved highlights** or **Current conversation**, then **Export for Apple Notes (.txt)**. Save unfinished note edits before exporting.
3. On your Mac, open Notes, select a folder under **iCloud**, and use **File → Import to Notes** to import the downloaded text file.
4. Enable Notes in iCloud on your Mac and iPhone using the same Apple Account. See [Apple's import instructions](https://support.apple.com/en-gb/102223) and [iCloud Notes setup](https://support.apple.com/guide/icloud/set-up-notes-mm8685520792/icloud).

Exports contain full quotes, saved notes, source URLs, colours as labels and saved dates, grouped by conversation. Text export works with older macOS versions; Apple documents formatted Markdown import for macOS/iOS 26 and later. Markdown export is also available for other reading apps. No connection to your Apple account is made by Glint.

These are snapshots: new highlights require another export, repeated Notes imports create another note, and edits in Notes do not return to Glint. iCloud syncs the imported note, not Glint's browser storage. Glint currently has no iPhone extension; restoring website highlights in iPhone Safari would require a Safari port as well as a shared sync mechanism. Apple supports [Safari extensions on iPhone, iPad and Mac](https://developer.apple.com/safari/extensions/).

## Transfer existing highlights between browsers

1. In the Firefox version, open **Export & transfer**, choose **All saved highlights**, and **Download Glint backup (.json)**.
2. Load Glint in the destination browser, open **Export & transfer**, select that JSON file, review the highlight count and choose **Import missing highlights**.
3. Open the original pages in the destination browser. Glint attempts restoration as the matching passages load; changed or unavailable text remains unresolved.

JSON preserves quote/context/offset anchors, conversation and message identity, colours, notes, URLs and IDs. Imports validate the complete file before writing, accept up to 10 MB and 20,000 highlights, and add missing IDs within each conversation. Existing local entries win, including their notes and colours. Imports do not propagate edits or deletions; importing an old backup may restore deleted entries. A library that exceeds the limit can be exported by individual conversation. Large-library export memory has not been profiled.

Export/import is manual transfer, not ongoing synchronization. Browser-managed `storage.sync` is not a shared Firefox–Chromium store, and [Chrome limits it to about 100 KB total / 8 KB per item](https://developer.chrome.com/docs/extensions/reference/api/storage). A future automatic sync implementation needs an explicit destination, authentication and conflict/deletion handling. No server, cloud SDK, analytics or background polling has been added.

## Highlight controls

Choose from eight colours: yellow, orange, pink, purple, blue, teal, green and peach. **Custom colour…** opens a native picker and a six-digit hex field; choose **Apply & save** to apply and remember it. Saved custom colours appear in the page palette and sidebar colour menu across conversations in this browser profile, even after their highlights are deleted. Previously used custom colours are collected once from existing highlights when this feature is first used. Saved palettes are local and are not included in JSON transfers.

Ordinary text uses solid highlight backgrounds so light and dark page backgrounds do not dilute the selected colour. Highlighted text uses contrasting black or white lettering based on the chosen colour; typography remains unchanged. Recognised PDF.js/React-PDF text layers retain transparent lettering and 40% background opacity to preserve underlying canvas artwork. Active canvas-backed layers also retain multiply blending for dark PDF lettering. Actual ChatGPT PDF preview and dark/recoloured PDF acceptance remain pending.

Delete a saved custom colour with its × button in the page palette or under **Manage saved colours** in a sidebar editor. This removes only the reusable swatch; existing highlights keep their colour. Applying that custom colour again saves it again.

Click coloured text (or select it again) to change its colour or choose the labelled **Remove highlight** action, separated from the swatches. If several highlights overlap, the action applies to all of them. This removes highlights; there is no undo history.

The popup and sidebar keep the current conversation first, with its website clearly visible. Expand **Saved websites**, then a website and conversation to browse other highlights. Cards show a compact quote; expand **Edit highlight** for colour, custom colour, Remove and notes. Choose **Save note** explicitly; unsaved drafts and focus survive automatic refreshes while the panel remains open. Closing the popup/sidebar discards unsaved drafts. Current-conversation quotes jump to the passage; other quotes open their saved page without automatically jumping to the passage.

The default view reads only the current conversation and initially renders up to 25 cards. **Show 25 more** reveals another batch. Other conversations load when expanded and release their rows when collapsed. The first opening of Saved websites builds a local summary index from existing records without changing them; later writes maintain it. Website labels use local text badges and make no favicon requests. The sidebar follows the system light/dark theme.

After updating the extension, run `npm run build`, reload the extension in `about:debugging`, then reload any pages that were already open. Close an already-open sidebar once; the toolbar now uses a popup and installation no longer opens the sidebar automatically. This controls the extension's panel, not Zen's own tab/sidebar toolbar.

Run `npm test` for anchor, editing, colour, storage migration and sidebar tests and `npm run check` for JavaScript syntax checks. Rebuild and reload the temporary extension after changes. Temporary add-ons must be loaded again after restarting Firefox; use a signed package for permanent installation.

Version 0.3.4 packages are `glint-0.3.4-firefox.xpi` (unsigned) and `glint-0.3.4-chromium.zip` (extract before loading unpacked). Older packages may remain locally and are ignored by Git. No upload or signing has been performed.

Glint was previously named Persistent Highlighter. Its Firefox extension ID and storage format remain unchanged so the rename preserves existing highlights when updating the same installation.

## How it works

### Recover highlights when a URL changes

Open the destination page, open Glint's popup or sidebar, and expand **Link saved highlights to this page**. Choose the old saved conversation, select **Preview matches**, review the matched/missing/ambiguous passages, then choose **Confirm link to this page**. Closing the controls before confirmation makes no recovery copies. Preview rows appear in batches of 25. Load any lazy-loaded text before previewing for the most useful result.

This works on regular supported HTTP(S) pages, including unlisted providers and moves between providers. Confirmation copies all selected-conversation records onto the destination with new IDs, preserving the originals, quotes, notes, colours and original capture URLs. Missing and ambiguous passages remain unresolved and are checked again as text loads. Recovery uses exact text and uniquely ranked surrounding context across the page, never old offsets or source message IDs to break a tie. The current list displays the recovery status; jumping to an unresolved copy reports that the passage is unavailable. Source records and the destination page are rechecked on confirmation; a changed preview must be regenerated.

Copies are independently editable and removable using the ordinary highlight controls. Repeating a link skips copies already linked from that source conversation/highlight ID and keeps local edits; deleting a copy and explicitly linking again recreates it. This is a snapshot of the selected records, not a permanent URL alias or synchronization rule, so new source highlights require another link. No external requests or provider APIs are used for recovery.

JSON backups that contain recovered highlights use format version 2 to preserve recovery provenance and conservative matching. Glint 0.3.0 accepts versions 1 and 2; earlier Glint releases reject version 2. Backups without recovered highlights remain version 1.

Annotations contain exact text, surrounding context, text offsets, conversation URL, provider, message identity when exposed, colour, and note. Storage is partitioned by conversation; writes are serialized in the background. A per-message index limits restoration work for inserted provider messages. Text-node ranges are rendered through CSS Custom Highlights; application text is never wrapped or rewritten. A MutationObserver restores after message replacement, and history navigation triggers a conversation reload.

The generic adapter uses the full URL without its fragment. Recognized ChatGPT (`/c/{id}`), Claude (`/chat/{id}`), Gemini (`/app/{id}`) and DeepSeek (`/a/chat/s/{id}`) routes use the provider plus stable conversation ID. Project names, surrounding path segments, query parameters and ChatGPT's old hostname therefore do not split one conversation. Provider pages without a recognized conversation route retain their pathname identity, and unknown websites retain the generic URL identity.

The first background operation after upgrading performs a one-time identity migration. It merges old provider URL keys into canonical conversation keys, deduplicates by highlight ID, rebuilds the library summary, writes canonical data before removing obsolete keys, and records the migration version. Records already under the canonical key take precedence if the same ID differs. The original capture URL remains in `originalUrl`; opening the conversation refreshes `url` to the latest working address for navigation. Imported JSON backups use the same normalization. Passage restoration still requires message identity and exact quote/context matching, so a shared conversation ID never authorizes an unrelated text match.

Provider selectors are best-effort and may require updates when sites change. DeepSeek currently uses exposed `data-message-id` elements when present and otherwise falls back to page scope. Messages without stable IDs require an exact quote and saved prefix/suffix with one unique occurrence across loaded candidate messages; offsets do not break ties between messages. Identical passages with identical context remain unresolved, and changed context can also prevent restoration. This applies to existing records without a migration. Cross-message selections fall back to page scope. Changed quotations are left unresolved; clicking an unloaded passage reports that it must be loaded first.

Version 0.3.4 fixes ID-less message matches overwriting one another during restoration. Changes to a captured selection now produce a visible retry message, and stale ranges cannot be used to recolour or remove a passage. Mutation processing runs 150 ms after the first queued change even during continuous streaming; this bounds the scheduling delay, not the duration of a large restoration batch. Anonymous-message resolution shares one temporary text index per root. Gemini-shaped DOM regression tests cover repeated quotations, adding/deleting highlights, removal/reinsertion, ambiguous passages, stale selections and streaming. Live signed-in Gemini/Zen verification remains outstanding. Reload the extension and existing pages after updating.

## Transfer and Chromium verification

Run `npm test`, `npm run check` and `npm run build`. `npm run package` also builds and produces versioned Firefox XPI and Chromium ZIP files, checking their contents against the build.

An installed-extension smoke test is available as `node scripts/browser-smoke.js /path/to/chromium`. It needs permission to launch a headless browser and a loopback HTTP fixture. It creates a fresh temporary profile, uses generated test passages only, and leaves its profile/downloads in the printed temporary directory for inspection. Use a Chromium executable that accepts `--load-extension` (some branded Chrome releases restrict this flag).

Verified on macOS 14.8.9 with Helium 0.16.6.1 / Chromium 152.0.7977.82: installed-extension creation, custom recolour and note writes, restoration after reload, text download, JSON file import, duplicate skipping and deletion. Interactive toolbar/sidebar gestures, Firefox installation/update acceptance, signed-in providers, Apple Notes import and actual iCloud delivery, background suspension/restart and RAM profiling still require verification.

## Manual acceptance checks

- Highlight a selection crossing bold/inline text; reload and check restoration.
- Try the keyboard shortcut and selection context menu.
- Try all eight colours and custom hex values; reload and check appearance. Check passages containing bold, italics, links and inline code: text formatting, spacing and line breaks should remain unchanged. Choose backgrounds that are readable with the page’s existing text colour.
- Check palette placement near viewport edges and keyboard focus, including the native colour picker.
- Expand a card, change colour, choose **Save note**, and remove from the sidebar; verify after reload.
- Edit a note while another highlight changes; confirm focus and the unsaved draft survive.
- Expand Saved websites and multiple conversations; confirm counts, grouping and Show 25 more.
- Navigate between conversations without a full page reload; verify sidebar and page highlights switch.
- Replace a highlighted message DOM node, and remove/reinsert it; verify automatic restoration.
- Test ChatGPT, Claude, Gemini and DeepSeek against current signed-in pages, including long lazy-loaded conversations and provider/project URL changes.

Only top-level HTTP(S) documents are supported. Browser-protected pages, form controls, editable areas, shadow DOM and iframe text are excluded. The extension requests access to web pages to restore highlights automatically, and tabs access to follow the active conversation. No analytics, remote services or synchronization are included.

Sidebar and palette layouts were checked using sample data in headless Zen 1.22b on macOS 14.8.9. Automated DOM tests do not verify the installed extension, native colour-picker interaction, current signed-in provider pages, or RAM use; those live checks remain outstanding.
