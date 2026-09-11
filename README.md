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

Choose from eight colours: yellow, orange, pink, purple, blue, teal, green and peach. **Custom colour…** opens a native picker and a six-digit hex field; choose **Apply** to save it. Custom colours persist and use light or dark text according to their contrast.

Click coloured text (or select it again) to change its colour or choose the labelled **Remove highlight** action, separated from the swatches. If several highlights overlap, the action applies to all of them. This removes highlights; there is no undo history.

The popup and sidebar keep the current conversation first, with its website clearly visible. Expand **Saved websites**, then a website and conversation to browse other highlights. Cards show a compact quote; expand **Edit highlight** for colour, custom colour, Remove and notes. Choose **Save note** explicitly; unsaved drafts and focus survive automatic refreshes while the panel remains open. Closing the popup/sidebar discards unsaved drafts. Current-conversation quotes jump to the passage; other quotes open their saved page without automatically jumping to the passage.

The default view reads only the current conversation and initially renders up to 25 cards. **Show 25 more** reveals another batch. Other conversations load when expanded and release their rows when collapsed. The first opening of Saved websites builds a local summary index from existing records without changing them; later writes maintain it. Website labels use local text badges and make no favicon requests. The sidebar follows the system light/dark theme.

After updating the extension, run `npm run build`, reload the extension in `about:debugging`, then reload any pages that were already open. Close an already-open sidebar once; the toolbar now uses a popup and installation no longer opens the sidebar automatically. This controls the extension's panel, not Zen's own tab/sidebar toolbar.

Run `npm test` for anchor, editing, colour, storage migration and sidebar tests and `npm run check` for JavaScript syntax checks. Rebuild and reload the temporary extension after changes. Temporary add-ons must be loaded again after restarting Firefox; use a signed package for permanent installation.

Version 0.2.0 packages are `glint-0.2.0-firefox.xpi` (unsigned) and `glint-0.2.0-chromium.zip` (extract before loading unpacked). The older `glint.xpi` (0.1.2) and `persistent-highlighter.xpi` have been retained. No upload or signing has been performed.

Glint was previously named Persistent Highlighter. Its Firefox extension ID and storage format remain unchanged so the rename preserves existing highlights when updating the same installation.

## How it works

Annotations contain exact text, surrounding context, text offsets, conversation URL, provider, message identity when exposed, colour, and note. Storage is partitioned by conversation; writes are serialized in the background. A per-message index limits restoration work for inserted provider messages. Text-node ranges are rendered through CSS Custom Highlights; application text is never wrapped or rewritten. A MutationObserver restores after message replacement, and history navigation triggers a conversation reload.

The generic adapter uses the URL without its fragment. ChatGPT, Claude and Gemini adapters use origin and pathname, with provider message selectors. Selectors are best-effort and may require updates when those sites change. Messages without stable IDs use quote/context matching within candidate message roots. Identical messages without IDs can be ambiguous. Cross-message selections fall back to page scope. Changed quotations are left unresolved; clicking an unloaded passage reports that it must be loaded first.

## Transfer and Chromium verification

Run `npm test`, `npm run check` and `npm run build`. `npm run package` also builds and produces versioned Firefox XPI and Chromium ZIP files, checking their contents against the build.

An installed-extension smoke test is available as `node scripts/browser-smoke.js /path/to/chromium`. It needs permission to launch a headless browser and a loopback HTTP fixture. It creates a fresh temporary profile, uses generated test passages only, and leaves its profile/downloads in the printed temporary directory for inspection. Use a Chromium executable that accepts `--load-extension` (some branded Chrome releases restrict this flag).

Verified on macOS 14.8.9 with Helium 0.16.6.1 / Chromium 152.0.7977.82: installed-extension creation, custom recolour and note writes, restoration after reload, text download, JSON file import, duplicate skipping and deletion. Interactive toolbar/sidebar gestures, Firefox installation/update acceptance, signed-in providers, Apple Notes import and actual iCloud delivery, background suspension/restart and RAM profiling still require verification.

## Manual acceptance checks

- Highlight a selection crossing bold/inline text; reload and check restoration.
- Try the keyboard shortcut and selection context menu.
- Try all eight colours and custom hex values, including very dark colours; reload and check appearance.
- Check palette placement near viewport edges and keyboard focus, including the native colour picker.
- Expand a card, change colour, choose **Save note**, and remove from the sidebar; verify after reload.
- Edit a note while another highlight changes; confirm focus and the unsaved draft survive.
- Expand Saved websites and multiple conversations; confirm counts, grouping and Show 25 more.
- Navigate between conversations without a full page reload; verify sidebar and page highlights switch.
- Replace a highlighted message DOM node, and remove/reinsert it; verify automatic restoration.
- Test all three providers against current signed-in pages, including long lazy-loaded conversations.

Only top-level HTTP(S) documents are supported. Browser-protected pages, form controls, editable areas, shadow DOM and iframe text are excluded. The extension requests access to web pages to restore highlights automatically, and tabs access to follow the active conversation. No analytics, remote services or synchronization are included.

Sidebar and palette layouts were checked using sample data in headless Zen 1.22b on macOS 14.8.9. Automated DOM tests do not verify the installed extension, native colour-picker interaction, current signed-in provider pages, or RAM use; those live checks remain outstanding.
