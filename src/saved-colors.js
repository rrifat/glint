import { browser } from "./browser.js";
export const SAVED_COLORS_KEY = "saved-custom-colors-v1";
export function customColors(values) {
  return [
    ...new Set(
      values
        .filter(
          (value) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value),
        )
        .map((value) => value.toLowerCase()),
    ),
  ];
}
export async function loadSavedColors() {
  const result = await browser.runtime.sendMessage({ type: "saved-colors" });
  if (!result?.ok)
    throw new Error(result?.error || "Could not load saved colours.");
  return result.colors;
}
export async function deleteSavedColor(color) {
  const result = await browser.runtime.sendMessage({
    type: "delete-saved-color",
    color,
  });
  if (!result?.ok)
    throw new Error(result?.error || "Could not delete saved colour.");
}
export async function readSavedColors(storage) {
  const stored = (await storage.get(SAVED_COLORS_KEY))[SAVED_COLORS_KEY];
  if (Array.isArray(stored)) return customColors(stored);
  // One-time discovery includes custom colours saved by earlier versions.
  const data = await storage.get(null);
  return customColors(
    Object.entries(data)
      .filter(
        ([key, rows]) => key.startsWith("annotations:") && Array.isArray(rows),
      )
      .flatMap(([, rows]) => rows.map((row) => row.color)),
  );
}
