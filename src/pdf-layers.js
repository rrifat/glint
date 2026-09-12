// PDF viewers paint the visible glyphs on a canvas beneath transparent DOM text.
// Blend only recognised, canvas-backed text layers that contain Glint ranges.
const selector = ".textLayer, .react-pdf__Page__textContent";
const attribute = "data-glint-pdf-highlight";
export function createPdfLayerTracker() {
  let active = new Set();
  return (ranges) => {
    const next = new Set();
    for (const range of ranges) {
      for (const node of [range.startContainer, range.endContainer]) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        const layer = element?.closest(selector);
        if (
          !layer?.isConnected ||
          !layer.parentElement?.querySelector(
            ":scope > canvas, :scope > .canvasWrapper > canvas, :scope > .react-pdf__Page__canvas",
          )
        )
          continue;
        // A range spanning pages can include intermediate text layers too.
        const root = range.commonAncestorContainer;
        const container = root.nodeType === 1 ? root : root.parentElement;
        for (const candidate of [
          layer,
          ...container.querySelectorAll(selector),
        ]) {
          if (
            range.intersectsNode(candidate) &&
            candidate.parentElement?.querySelector(
              ":scope > canvas, :scope > .canvasWrapper > canvas, :scope > .react-pdf__Page__canvas",
            )
          )
            next.add(candidate);
        }
      }
    }
    for (const layer of active)
      if (!next.has(layer)) layer.removeAttribute(attribute);
    for (const layer of next)
      if (!active.has(layer)) layer.setAttribute(attribute, "");
    active = next;
  };
}
