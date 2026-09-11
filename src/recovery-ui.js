import { browser } from "./browser.js";
import { element } from "./sidebar-ui.js";

export function makeRecovery({ showError, refresh }) {
  const node = element("details", { className: "library recovery" });
  node.append(
    element("summary", { text: "Link saved highlights to this page" }),
  );
  const body = element("div");
  node.append(body);
  let target = null,
    selectedSource = "",
    preview = null,
    version = 0;
  let select,
    previewButton,
    confirm,
    resultList,
    counts,
    more,
    shown = 0;
  async function request(message) {
    const result = await browser.runtime.sendMessage(message);
    if (!result?.ok)
      throw new Error(result?.error || "Could not link highlights. Try again.");
    return result;
  }
  function invalidate() {
    ++version;
    preview = null;
    if (confirm) confirm.disabled = true;
    if (previewButton) previewButton.disabled = !selectedSource || !target;
    resultList?.replaceChildren();
    if (counts)
      counts.textContent = "Preview the currently loaded text before linking.";
    if (more) more.hidden = true;
  }
  function renderMore() {
    if (!preview) return;
    for (const item of preview.passages.slice(shown, shown + 25)) {
      const row = element("li");
      const label = {
        matched: "Matched",
        missing: "Unresolved — not found in loaded text",
        ambiguous: "Unresolved — ambiguous match",
      }[item.status];
      row.append(
        element("strong", { text: label }),
        element("p", { text: item.quote }),
      );
      resultList.append(row);
    }
    shown += 25;
    more.hidden = shown >= preview.passages.length;
  }
  async function open() {
    invalidate();
    selectedSource = "";
    body.replaceChildren();
    if (!target) {
      body.append(
        element("p", {
          text: "Open a regular web page with Glint enabled to recover highlights.",
        }),
      );
      return;
    }
    const token = version;
    body.append(
      element("p", { className: "muted", text: `Destination: ${target.url}` }),
    );
    body.append(
      element("p", {
        text: "Choose the saved conversation whose highlights belong here. Linking creates editable copies, including unresolved passages. Original highlights remain on their saved page; later edits are independent. Save unfinished notes first.",
      }),
    );
    const label = element("label", { text: "Saved conversation" });
    select = element("select", {
      attrs: { "aria-label": "Saved conversation to recover" },
    });
    select.append(
      element("option", {
        text: "Choose a saved conversation",
        attrs: { value: "" },
      }),
    );
    label.append(select);
    body.append(label);
    previewButton = element("button", {
      className: "show-more",
      text: "Preview matches",
    });
    previewButton.disabled = true;
    counts = element("p", { attrs: { role: "status" } });
    resultList = element("ol", { className: "recovery-results" });
    more = element("button", {
      className: "show-more",
      text: "Show 25 more",
      on: { click: renderMore },
    });
    more.hidden = true;
    confirm = element("button", {
      className: "show-more",
      text: "Confirm link to this page",
    });
    confirm.disabled = true;
    body.append(previewButton, counts, resultList, more, confirm);
    select.addEventListener("change", () => {
      selectedSource = select.value;
      invalidate();
    });
    previewButton.addEventListener("click", async () => {
      invalidate();
      const requestVersion = version;
      const destination = { ...target };
      const source = selectedSource;
      previewButton.disabled = true;
      counts.textContent = "Checking loaded passages…";
      try {
        const result = await request({
          type: "recovery-preview",
          target: destination,
          source,
        });
        if (version !== requestVersion || !node.open) return;
        preview = { ...result, target: destination, source };
        shown = 0;
        const count = (status) =>
          result.passages.filter((item) => item.status === status).length;
        counts.textContent = `${count("matched")} matched · ${count("missing")} missing · ${count("ambiguous")} ambiguous. Missing or ambiguous passages stay unresolved and will be checked again as text loads.`;
        renderMore();
        confirm.disabled = false;
      } catch (error) {
        if (version === requestVersion) showError(error);
      } finally {
        if (version === requestVersion) previewButton.disabled = false;
      }
    });
    confirm.addEventListener("click", async () => {
      if (!preview) return;
      const chosen = preview;
      const operationVersion = version;
      const statusNode = counts,
        sourceSelect = select,
        previewControl = previewButton;
      confirm.disabled = true;
      previewButton.disabled = true;
      select.disabled = true;
      try {
        const result = await request({
          type: "recovery-confirm",
          target: chosen.target,
          source: chosen.source,
          stamp: chosen.stamp,
        });
        if (version === operationVersion) {
          invalidate();
          statusNode.textContent = `Linked ${result.added} highlights; skipped ${result.skipped} existing copies. Original highlights were preserved.`;
        }
        // Outside the background queue: reload itself requests annotations there.
        await browser.tabs
          .sendMessage(chosen.target.tabId, { type: "navigate" })
          .catch(() => {});
        await refresh();
      } catch (error) {
        if (version === operationVersion) {
          invalidate();
          showError(error);
        }
      } finally {
        sourceSelect.disabled = false;
        previewControl.disabled = !sourceSelect.value;
      }
    });
    try {
      const result = await request({ type: "library" });
      if (version !== token || !node.open) return;
      for (const item of result.summaries.filter(
        (item) => item.conversation !== target.conversation,
      )) {
        select.append(
          element("option", {
            text: `${item.title || item.url} — ${item.url} (${item.count})`,
            attrs: { value: item.conversation },
          }),
        );
      }
      if (select.options.length === 1)
        counts.textContent = "No other saved conversations are available.";
    } catch (error) {
      if (version === token) showError(error);
    }
  }
  node.addEventListener("toggle", () => {
    if (node.open) void open();
    else {
      invalidate();
      selectedSource = "";
      body.replaceChildren();
      select = previewButton = confirm = resultList = counts = more = null;
    }
  });
  return {
    node,
    invalidate,
    setTarget(next) {
      if (JSON.stringify(next) === JSON.stringify(target)) return;
      target = next;
      invalidate();
      if (node.open) void open();
    },
  };
}
