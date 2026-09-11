// Modern MV3 APIs return promises in both engines, except older Chromium message listeners.
export const browser = globalThis.browser ?? globalThis.chrome;

export function onMessage(handler) {
  if (globalThis.browser) {
    browser.runtime.onMessage.addListener(handler);
    return;
  }
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    let result;
    try {
      result = handler(message, sender);
    } catch (error) {
      respond({ ok: false, error: error.message });
      return false;
    }
    if (result === undefined) return false;
    Promise.resolve(result).then(
      (value) => respond(value ?? { ok: true }),
      (error) => respond({ ok: false, error: error.message }),
    );
    return true; // Keep this message channel open until the write finishes.
  });
}
