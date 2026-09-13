import { createPdfLayerTracker } from "./pdf-layers.js";
import { loadSavedColors, deleteSavedColor } from "./saved-colors.js";
import { adapterFor } from "./adapters.js";
import { browser, onMessage } from "./browser.js";
import {
  createAnchor,
  resolveAnchor,
  textIndex,
  rangeFromMatch,
} from "./anchors.js";
import { recoveryMatch } from "./recovery.js";
const recoveryDocument = crypto.randomUUID();
const recoveryStatuses = new Map();
import { keyFor, loadConversation } from "./storage.js";
import {
  COLORS,
  colorValue,
  isColor,
  highlightName,
  textColor,
} from "./colors.js";
let adapter = adapterFor();
let conversation = adapter.identity();
let annotations = [];
let byMessage = new Map();
const ranges = new Map();
let selected = null;
let generation = 0;
let editingIds = [];
const supported =
  !!globalThis.CSS?.highlights && typeof Highlight !== "undefined";
const host = document.createElement("div");
host.dataset.phUi = "";
const shadow = host.attachShadow({ mode: "closed" });
shadow.innerHTML = `<style>
:host{all:initial}.palette{position:fixed;z-index:2147483647;width:288px;max-width:calc(100vw - 16px);padding:12px;background:#fff;color:#252b36;border:1px solid #dce0e8;border-radius:14px;box-shadow:0 6px 28px #0003;font:13px/1.4 system-ui;box-sizing:border-box}
.caption{font-size:11px;font-weight:650;color:#646c7a;margin-bottom:9px}.swatches{display:flex;gap:5px;flex-wrap:wrap}button,input{font:inherit;box-sizing:border-box}button{cursor:pointer}.swatch{width:28px;height:28px;border:1px solid #0002;border-radius:50%;background:var(--swatch);display:grid;place-items:center;padding:0;color:var(--ink)}.swatch[aria-pressed=true]::after{content:'✓';font-weight:bold;font-size:17px}.swatch:hover{transform:scale(1.08)}button:focus-visible,input:focus-visible{outline:2px solid #5269b2;outline-offset:3px}.custom-toggle{margin-top:10px;border:1px solid #dce0e8;border-radius:7px;background:#f7f8fb;padding:6px 10px;color:inherit;width:100%;text-align:left}.custom{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px}.custom input[type=color]{width:32px;height:30px;padding:2px;border:1px solid #c7ced9;border-radius:5px}.custom input[type=text]{width:96px;min-width:0;padding:5px;border:1px solid #c7ced9;border-radius:5px}.apply{background:#344968;color:white;border:0;border-radius:5px;padding:6px 10px}.remove{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin-top:11px;padding:9px 4px 0;border:0;border-top:1px solid #e7e9ee;background:none;color:#a03339;font-size:12px}.remove svg{width:15px;height:15px;flex:none;display:block}.status{position:fixed;bottom:20px;left:20px;background:#20252d;color:white;padding:12px;border-radius:8px;font:14px system-ui;z-index:2147483647}[hidden]{display:none!important}
</style><div class="palette" role="group" aria-label="Highlight controls" hidden><div class="caption">Highlight colour</div><div class="swatches" role="group" aria-label="Preset colours"></div><button class="custom-toggle" aria-expanded="false">Custom colour…</button><div class="custom" hidden><input type="color" value="#ffe082" aria-label="Custom colour picker"><input type="text" value="#ffe082" aria-label="Custom colour hex code" spellcheck="false" maxlength="7"><button class="apply">Apply</button></div></div><div class="status" role="status" hidden></div>`;
document.documentElement.append(host);
const palette = shadow.querySelector(".palette");
const status = shadow.querySelector(".status");
const custom = shadow.querySelector(".custom");
const picker = custom.querySelector("[type=color]");
const hex = custom.querySelector("[type=text]");
const customToggle = shadow.querySelector(".custom-toggle");
let statusTimer;
function notify(message) {
  status.textContent = message;
  status.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.hidden = true), 5000);
}
function swatch(color) {
  const button = document.createElement("button");
  button.className = "swatch";
  button.dataset.color = color;
  button.style.setProperty("--swatch", colorValue(color));
  button.style.setProperty("--ink", textColor(color));
  button.title = `Highlight ${color}`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => void save(color));
  return button;
}
COLORS.forEach((color) =>
  shadow.querySelector(".swatches").append(swatch(color)),
);
const savedSection = document.createElement("div");
savedSection.hidden = true;
savedSection.style.marginTop = "10px";
const savedCaption = document.createElement("div");
savedCaption.className = "caption";
savedCaption.textContent = "Saved custom colours";
const savedSwatches = document.createElement("div");
savedSwatches.className = "swatches";
savedSwatches.style.maxHeight = "112px";
savedSwatches.style.overflowY = "auto";
savedSwatches.setAttribute("aria-label", "Saved custom colours");
savedSection.append(savedCaption, savedSwatches);
customToggle.before(savedSection);
let savedRequest = 0;
async function refreshSavedColors() {
  const request = ++savedRequest;
  try {
    const colors = await loadSavedColors();
    if (request !== savedRequest || palette.hidden) return;
    const active = new Set(
      annotations
        .filter((a) => editingIds.includes(a.id))
        .map((a) => colorValue(a.color)),
    );
    savedSwatches.replaceChildren(
      ...colors.map((color) => {
        const button = swatch(color);
        button.setAttribute(
          "aria-pressed",
          String(active.size === 1 && active.has(color)),
        );
        const entry = document.createElement("span");
        entry.style.cssText = "display:flex;align-items:center;gap:2px";
        const remove = document.createElement("button");
        remove.textContent = "×";
        remove.title = `Delete saved colour ${color}`;
        remove.setAttribute("aria-label", remove.title);
        remove.style.cssText =
          "background:none;border:0;padding:5px;color:inherit";
        remove.addEventListener("mousedown", (event) => event.preventDefault());
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await deleteSavedColor(color);
            await refreshSavedColors();
            customToggle.focus();
            notify("Saved colour deleted. Existing highlights are unchanged.");
          } catch (error) {
            notify(error.message);
            remove.disabled = false;
          }
        });
        entry.append(button, remove);
        return entry;
      }),
    );
    savedSection.hidden = !colors.length;
    positionPalette();
  } catch (error) {
    notify(error.message);
  }
}
custom.querySelector(".apply").textContent = "Apply & save";
let paletteRect;
let paletteConversation;
function positionPalette() {
  if (!paletteRect) return;
  const bounds = palette.getBoundingClientRect();
  palette.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, paletteRect.left))}px`;
  const below = paletteRect.bottom + 8;
  palette.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, below))}px`;
}
customToggle.addEventListener("click", () => {
  custom.hidden = !custom.hidden;
  customToggle.setAttribute("aria-expanded", String(!custom.hidden));
  positionPalette();
  if (!custom.hidden) hex.focus();
});
picker.addEventListener("input", () => {
  hex.value = picker.value;
  hex.removeAttribute("aria-invalid");
});
hex.addEventListener("input", () => {
  if (/^#[\da-f]{6}$/i.test(hex.value)) picker.value = hex.value;
  hex.removeAttribute("aria-invalid");
});
function applyCustom() {
  if (!/^#[\da-f]{6}$/i.test(hex.value)) {
    hex.setAttribute("aria-invalid", "true");
    notify("Enter a six-digit hex colour, such as #a9d5ff.");
    hex.focus();
    return;
  }
  void save(hex.value.toLowerCase());
}
custom.querySelector(".apply").addEventListener("click", applyCustom);
hex.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyCustom();
});
const removeButton = document.createElement("button");
removeButton.className = "remove";
removeButton.innerHTML =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg><span>Remove highlight</span>';
removeButton.title = "Remove highlight";
removeButton.setAttribute("aria-label", "Remove highlight");
removeButton.hidden = true;
removeButton.addEventListener("mousedown", (event) => event.preventDefault());
removeButton.addEventListener("click", () => void editHighlights("delete"));
palette.append(removeButton);
function showPalette(rect) {
  removeButton.hidden = !editingIds.length;
  removeButton.querySelector("span").textContent =
    editingIds.length > 1
      ? `Remove ${editingIds.length} highlights`
      : "Remove highlight";
  const colors = new Set(
    annotations.filter((a) => editingIds.includes(a.id)).map((a) => a.color),
  );
  for (const button of shadow.querySelectorAll(".swatch"))
    button.setAttribute(
      "aria-pressed",
      String(colors.size === 1 && colors.has(button.dataset.color)),
    );
  if (colors.size === 1) {
    picker.value = colorValue([...colors][0]);
    hex.value = picker.value;
  }
  custom.hidden = true;
  customToggle.setAttribute("aria-expanded", "false");
  paletteConversation = conversation;
  paletteRect = rect;
  palette.hidden = false;
  void refreshSavedColors();
  positionPalette();
}
function selectedHighlights(range) {
  return annotations
    .filter((a) => {
      const saved = ranges.get(a.id);
      return (
        saved &&
        range.compareBoundaryPoints(Range.START_TO_END, saved) > 0 &&
        range.compareBoundaryPoints(Range.END_TO_START, saved) < 0
      );
    })
    .map((a) => a.id);
}
async function editHighlights(type, color) {
  if (
    adapter.identity() !== conversation ||
    paletteConversation !== conversation
  ) {
    dismissPalette();
    await reload();
    notify("The page changed. Select the passage again.");
    return;
  }
  const ids = [...editingIds];
  const targetConversation = conversation;
  try {
    for (const id of ids) {
      const result = await browser.runtime.sendMessage({
        type,
        conversation: targetConversation,
        id,
        color,
      });
      if (!result?.ok)
        throw new Error(
          result?.error ||
            "Could not save the change. Reload the extension and page.",
        );
    }
    editingIds = [];
    selected = null;
    palette.hidden = true;
    getSelection()?.removeAllRanges();
    await reload();
    notify(type === "delete" ? "Highlight removed" : "Colour updated");
  } catch (error) {
    notify(error.message);
  }
}
function capture() {
  editingIds = [];
  const selection = getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    palette.hidden = true;
    selected = null;
    return;
  }
  const range = selection.getRangeAt(0);
  const element =
    range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (
    element?.closest(
      'input,textarea,[contenteditable]:not([contenteditable="false"])',
    ) ||
    host.contains(element)
  ) {
    dismissPalette();
    return;
  }
  selected = range.cloneRange();
  editingIds = selectedHighlights(range);
  showPalette(range.getBoundingClientRect());
}
document.addEventListener("mouseup", (event) => {
  if (event.composedPath().includes(host)) return;
  capture();
  if (!getSelection()?.isCollapsed) return;
  // Hit-test range rectangles without inserting wrappers into the page.
  editingIds = annotations
    .filter((a) => {
      const range = ranges.get(a.id);
      return (
        range &&
        [...range.getClientRects()].some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        )
      );
    })
    .map((a) => a.id);
  if (editingIds.length)
    showPalette({ left: event.clientX, bottom: event.clientY });
});
function dismissPalette() {
  palette.hidden = true;
  selected = null;
  editingIds = [];
  paletteRect = null;
  paletteConversation = null;
}
document.addEventListener("keyup", (event) => {
  if (event.key === "Escape") dismissPalette();
  else if (!event.composedPath().includes(host) && event.shiftKey) capture();
});
document.addEventListener("scroll", dismissPalette, true);
addEventListener("blur", () => {
  if (custom.hidden && document.activeElement !== host) dismissPalette();
});
async function save(color = "yellow") {
  if (!isColor(color)) return;
  if (
    adapter.identity() !== conversation ||
    (paletteConversation && paletteConversation !== conversation)
  ) {
    dismissPalette();
    await reload();
    notify("The page changed. Select the passage again.");
    return;
  }
  if (editingIds.length) return editHighlights("update", color);
  try {
    if (adapter.identity() !== conversation) await reload();
    if (!supported) throw new Error("Highlights require Firefox 140 or later.");
    const selection = getSelection();
    const range =
      selected ||
      (selection?.rangeCount && !selection.isCollapsed
        ? selection.getRangeAt(0).cloneRange()
        : null);
    if (!range || !range.startContainer.isConnected)
      throw new Error("Select some text first.");
    let root = adapter.root(range.startContainer);
    if (!root.contains(range.endContainer)) root = document.body;
    const anchor = createAnchor(root, range);
    if (!anchor.exact.trim()) return;
    const annotation = {
      id: crypto.randomUUID(),
      conversation,
      provider: adapter.name,
      messageId: adapter.messageId(root),
      scope: root === document.body ? "page" : "message",
      anchor,
      color,
      note: "",
      url: location.href,
      originalUrl: location.href,
      title: document.title,
      createdAt: Date.now(),
    };
    const result = await browser.runtime.sendMessage({
      type: "save",
      conversation,
      annotation,
    });
    if (!result?.ok)
      throw new Error(
        result?.error ||
          "Could not save the highlight. Reload the extension and page.",
      );
    await reload();
    palette.hidden = true;
    selected = null;
    selection?.removeAllRanges();
    notify("Highlight saved");
  } catch (error) {
    notify(error.message);
  }
}
const customStyle = document.createElement("style");
customStyle.dataset.phUi = "";
document.documentElement.append(customStyle);
const registered = new Set();
const updatePdfLayers = createPdfLayerTracker();
function register() {
  if (!supported) return;
  const groups = new Map(COLORS.map((color) => [highlightName(color), []]));
  const customColors = new Set();
  for (const annotation of annotations) {
    if (!isColor(annotation.color)) continue;
    const range = ranges.get(annotation.id);
    if (!range?.startContainer.isConnected || !range?.endContainer.isConnected)
      continue;
    const name = highlightName(annotation.color);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(range);
    if (annotation.color.startsWith("#"))
      customColors.add(colorValue(annotation.color));
  }
  updatePdfLayers([...groups.values()].flat());
  const rules = [...customColors]
    .map(
      (color) =>
        `::highlight(${highlightName(color)}){background-color:${color};color:${textColor(color) === "#ffffff" ? "#ffffff" : "#000000"};}\n:is(.textLayer,.react-pdf__Page__textContent) ::highlight(${highlightName(color)}),:is(.textLayer,.react-pdf__Page__textContent)::highlight(${highlightName(color)}){background-color:${color}66;color:transparent;}`,
    )
    .join("\n");
  if (customStyle.textContent !== rules) customStyle.textContent = rules;
  for (const name of registered)
    if (!groups.has(name)) {
      CSS.highlights.delete(name);
      registered.delete(name);
    }
  for (const [name, validRanges] of groups) {
    CSS.highlights.set(name, new Highlight(...validRanges));
    registered.add(name);
  }
}
function restore(root) {
  // One temporary index for all recovered passages, across provider boundaries.
  if (root === document.body && annotations.some((a) => a.recovery)) {
    const index = textIndex(root);
    let statusChanged = false;
    for (const a of annotations.filter((a) => a.recovery)) {
      const match = recoveryMatch(index.text, a.anchor);
      if (recoveryStatuses.get(a.id) !== match.status) statusChanged = true;
      recoveryStatuses.set(a.id, match.status);
      const range = rangeFromMatch(
        root,
        index,
        match.status === "matched" ? match : null,
      );
      if (range) ranges.set(a.id, range);
      else ranges.delete(a.id);
    }
    if (statusChanged)
      browser.runtime
        .sendMessage({ type: "recovery-status", conversation })
        .catch(() => {});
  }
  const id = adapter.messageId(root);
  const candidates =
    root === document.body
      ? annotations.filter((a) => a.scope === "page")
      : [...(byMessage.get(id) || [])];
  for (const a of candidates) {
    if (a.recovery) continue;
    if (a.scope === "page" && root !== document.body) continue;
    const range = resolveAnchor(root, a.anchor);
    if (range) ranges.set(a.id, range);
    else if (
      ranges.get(a.id)?.startContainer &&
      root.contains(ranges.get(a.id).startContainer)
    )
      ranges.delete(a.id);
  }
}
async function reload() {
  const token = ++generation;
  const next = adapterFor();
  const identity = next.identity();
  if (identity !== conversation) {
    dismissPalette();
    annotations = [];
    ranges.clear();
    recoveryStatuses.clear();
    byMessage.clear();
    register();
  }
  const rows = await loadConversation(identity, location.href, document.title);
  if (token !== generation || next.identity() !== identity) return;
  adapter = next;
  conversation = identity;
  annotations = rows;
  byMessage = new Map();
  ranges.clear();
  recoveryStatuses.clear();
  for (const a of rows) {
    const group = byMessage.get(a.messageId) || [];
    group.push(a);
    byMessage.set(a.messageId, group);
  }
  for (const root of new Set([document.body, ...adapter.roots()]))
    restore(root);
  register();
}
const dirty = new Set();
let timer;
const observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.target === host || host.contains(record.target)) continue;
    dirty.add(adapter.root(record.target));
    for (const node of record.addedNodes)
      if (node.nodeType === 1) {
        dirty.add(adapter.root(node));
        if (adapter.selector)
          node
            .querySelectorAll(adapter.selector)
            .forEach((root) => dirty.add(root));
      }
  }
  if (!dirty.size) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (adapter.identity() !== conversation) {
      dirty.clear();
      void reload();
      return;
    }
    for (const [id, range] of ranges)
      if (!range.startContainer.isConnected || !range.endContainer.isConnected)
        ranges.delete(id);
    for (const root of dirty) if (root.isConnected) restore(root);
    // Page-scoped selections can span several provider messages.
    if (annotations.some((a) => a.scope === "page")) restore(document.body);
    dirty.clear();
    register();
  }, 150);
});
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["data-message-id", "id"],
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[keyFor(conversation)]) void reload();
});
onMessage((msg) => {
  if (msg.type === "recovery-preview") {
    if (
      !supported ||
      msg.url !== location.href ||
      msg.conversation !== adapterFor().identity()
    )
      return Promise.resolve({
        ok: false,
        reason:
          "The page changed or does not support highlighting. Preview again.",
      });
    const index = textIndex(document.body);
    return Promise.resolve({
      ok: true,
      document: recoveryDocument,
      results: msg.rows.map((row) => ({
        id: row.id,
        ...recoveryMatch(index.text, row.anchor),
      })),
    });
  }
  if (msg.type === "highlight") {
    void save();
    return Promise.resolve({ ok: true });
  }
  if (msg.type === "navigate") {
    dismissPalette();
    return reload();
  }
  if (msg.type === "context")
    return Promise.resolve({
      conversation: adapterFor().identity(),
      title: document.title,
      supported,
      recoveryStatuses: Object.fromEntries(recoveryStatuses),
    });
  if (msg.type === "scroll")
    return (async () => {
      await reload();
      const range = ranges.get(msg.id);
      if (!range)
        return {
          ok: false,
          reason:
            "Passage is not loaded or its text has changed. Load the message and try again.",
        };
      range.startContainer.parentElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return { ok: true };
    })();
});
addEventListener("popstate", () => void reload());
void reload().catch((error) => notify(error.message));

addEventListener("pagehide", () => updatePdfLayers([]));
addEventListener("pageshow", (event) => {
  if (event.persisted) register();
});
