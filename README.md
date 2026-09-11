# Persistent Highlighter

See [AGENTS.md](AGENTS.md) for the architecture decisions, memory requirements, known gaps and agent handoff. The sidebar uses plain JavaScript and CSS; do not add a UI framework without an explicit, documented need.

A Firefox 140+ extension with a selection palette, Alt+Shift+H, selection context menu, persistent semantic anchors, CSS highlights, and a native JavaScript sidebar with colours and notes. Everything is stored locally in your Firefox profile.

## Develop and load

1. Run `npm install`, then `npm run build`.
2. Open Firefox `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**, then select `dist/manifest.json`.
4. Open a normal web page, select text, and choose a colour. Click the extension toolbar button to open the temporary highlights popup. Choose **Open sidebar** only when you want a persistent panel; use **Close sidebar** to dismiss it.

Choose from eight colours: yellow, orange, pink, purple, blue, teal, green and peach. **Custom colour…** opens a native picker and a six-digit hex field; choose **Apply** to save it. Custom colours persist and use light or dark text according to their contrast.

Click coloured text (or select it again) to change its colour or choose the labelled **Remove highlight** action, separated from the swatches. If several highlights overlap, the action applies to all of them. This removes highlights; there is no undo history.

The popup and sidebar keep the current conversation first, with its website clearly visible. Expand **Saved websites**, then a website and conversation to browse other highlights. Cards show a compact quote; expand **Edit highlight** for colour, custom colour, Remove and notes. Choose **Save note** explicitly; unsaved drafts and focus survive automatic refreshes while the panel remains open. Closing the popup/sidebar discards unsaved drafts. Current-conversation quotes jump to the passage; other quotes open their saved page without automatically jumping to the passage.

The default view reads only the current conversation and initially renders up to 25 cards. **Show 25 more** reveals another batch. Other conversations load when expanded and release their rows when collapsed. The first opening of Saved websites builds a local summary index from existing records without changing them; later writes maintain it. Website labels use local text badges and make no favicon requests. The sidebar follows the system light/dark theme.

After updating the extension, run `npm run build`, reload the extension in `about:debugging`, then reload any pages that were already open. Close an already-open sidebar once; the toolbar now uses a popup and installation no longer opens the sidebar automatically. This controls the extension's panel, not Zen's own tab/sidebar toolbar.

Run `npm test` for anchor, editing, colour, storage migration and sidebar tests and `npm run check` for JavaScript syntax checks. Rebuild and reload the temporary extension after changes. Temporary add-ons must be loaded again after restarting Firefox; use a signed package for permanent installation.

The updated `persistent-highlighter.xpi` in the project root is an unsigned 0.1.1 package containing the latest build, ready for the next upload/signing step. It has not been uploaded automatically.

## How it works

Annotations contain exact text, surrounding context, text offsets, conversation URL, provider, message identity when exposed, colour, and note. Storage is partitioned by conversation; writes are serialized in the background. A per-message index limits restoration work for inserted provider messages. Text-node ranges are rendered through CSS Custom Highlights; application text is never wrapped or rewritten. A MutationObserver restores after message replacement, and history navigation triggers a conversation reload.

The generic adapter uses the URL without its fragment. ChatGPT, Claude and Gemini adapters use origin and pathname, with provider message selectors. Selectors are best-effort and may require updates when those sites change. Messages without stable IDs use quote/context matching within candidate message roots. Identical messages without IDs can be ambiguous. Cross-message selections fall back to page scope. Changed quotations are left unresolved; clicking an unloaded passage reports that it must be loaded first.

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
