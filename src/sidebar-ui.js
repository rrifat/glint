import { COLORS, colorValue, colorName } from "./colors.js";

export function element(tag, { className, text, attrs = {}, on = {} } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs))
    node.setAttribute(name, value);
  for (const [event, handler] of Object.entries(on))
    node.addEventListener(event, handler);
  return node;
}
export function reconcile(parent, children) {
  children.forEach((child, index) => {
    if (parent.children[index] !== child)
      parent.insertBefore(child, parent.children[index] || null);
  });
  while (parent.children.length > children.length)
    parent.lastElementChild.remove();
}
export function website(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Saved pages";
  }
}
export function makeCard(initial, { change, jump, drafts, current = false }) {
  let annotation = initial;
  const article = element("article", { className: "highlight-card" });
  const quote = element("button", {
    className: "quote",
    on: { click: () => void jump(annotation) },
  });
  const editor = element("details", { className: "editor" });
  const recoveryStatus = element("p", { className: "muted" });
  recoveryStatus.hidden = true;
  const summary = element("summary");
  const label = element("span", { text: "Edit highlight" });
  const dot = element("span", {
    className: "colour-dot",
    attrs: { "aria-hidden": "true" },
  });
  summary.append(dot, label);
  editor.append(summary);
  let select, picker, note, saveNote, noteStatus;
  editor.addEventListener("toggle", () => {
    if (!editor.open || select) return;
    const controls = element("div", { className: "actions" });
    select = element("select", { attrs: { "aria-label": "Highlight colour" } });
    for (const color of COLORS)
      select.append(
        element("option", { text: colorName(color), attrs: { value: color } }),
      );
    select.append(
      element("option", { text: "Custom…", attrs: { value: "custom" } }),
    );
    const colourLabel = element("label", { text: "Colour " });
    colourLabel.append(select);
    picker = element("input", {
      attrs: { type: "color", "aria-label": "Custom highlight colour" },
    });
    select.addEventListener("change", () => {
      picker.hidden = select.value !== "custom";
      if (select.value !== "custom")
        void change(annotation, { color: select.value });
      else picker.focus();
    });
    picker.addEventListener(
      "change",
      () => void change(annotation, { color: picker.value }),
    );
    controls.append(
      colourLabel,
      picker,
      element("button", {
        className: "remove",
        text: "Remove",
        attrs: { title: "Remove highlight" },
        on: { click: () => void change(annotation, {}, "delete") },
      }),
    );
    const noteLabel = element("label", { className: "note", text: "Note" });
    note = element("textarea", {
      attrs: {
        "aria-label": "Highlight note",
        placeholder: "Add a thought…",
        rows: "2",
      },
    });
    note.value = drafts.get(annotation.id) ?? annotation.note ?? "";
    noteStatus = element("span", {
      className: "muted",
      attrs: { role: "status" },
    });
    saveNote = element("button", {
      className: "save-note",
      text: "Save note",
      on: {
        click: async () => {
          const value = note.value;
          saveNote.disabled = true;
          const ok = await change(annotation, { note: value });
          if (ok && note.value === value) {
            drafts.delete(annotation.id);
            noteStatus.textContent = "Saved";
          } else if (!ok) noteStatus.textContent = "Not saved — try again";
          saveNote.disabled = false;
        },
      },
    });
    note.addEventListener("input", () => {
      drafts.set(annotation.id, note.value);
      noteStatus.textContent = "Unsaved";
    });
    noteLabel.append(note);
    editor.append(controls, noteLabel, saveNote, noteStatus);
    update(annotation);
  });
  article.append(quote, recoveryStatus, editor);
  function update(next) {
    annotation = next;
    recoveryStatus.hidden = !next.recovery;
    recoveryStatus.textContent = !current
      ? "Linked copy · edits are independent of the original"
      : next.recoveryStatus === "matched"
        ? "Linked copy · matched in loaded text"
        : next.recoveryStatus === "ambiguous"
          ? "Linked copy · unresolved: ambiguous match"
          : "Linked copy · unresolved: passage not found in loaded text";
    article.style.setProperty("--accent", colorValue(next.color));
    quote.textContent = next.anchor.exact;
    quote.title = current ? "Go to passage" : "Open saved page";
    label.textContent =
      next.note || drafts.has(next.id)
        ? "Edit highlight · Note"
        : "Edit highlight";
    dot.title = colorName(next.color);
    if (select && document.activeElement !== select)
      select.value = COLORS.includes(next.color) ? next.color : "custom";
    if (picker && document.activeElement !== picker) {
      picker.value = colorValue(next.color);
      picker.hidden = select.value !== "custom";
    }
    if (note && document.activeElement !== note && !drafts.has(next.id))
      note.value = next.note || "";
  }
  update(initial);
  return { node: article, update };
}

export function makeList(handlers) {
  const node = element("div");
  const cards = new Map();
  let rows = [],
    limit = 25;
  const more = element("button", {
    className: "show-more",
    on: {
      click: () => {
        limit += 25;
        render();
      },
    },
  });
  function render() {
    const visible = rows.slice(0, limit);
    const ids = new Set(visible.map((a) => a.id));
    for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
    const children = visible.map((annotation) => {
      if (!cards.has(annotation.id))
        cards.set(annotation.id, makeCard(annotation, handlers));
      const card = cards.get(annotation.id);
      card.update(annotation);
      return card.node;
    });
    if (rows.length > limit) {
      more.textContent = `Show 25 more · ${rows.length - limit} remaining`;
      children.push(more);
    }
    reconcile(node, children);
  }
  return {
    node,
    update(next) {
      rows = [...next].sort((a, b) => b.createdAt - a.createdAt);
      render();
    },
  };
}
