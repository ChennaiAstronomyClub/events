const CAC_CHROME_URL =
  import.meta.env.VITE_CAC_CHROME_URL ??
  (import.meta.env.DEV
    ? "/chrome/cac-chrome.js"
    : "https://chennaiastronomyclub.org/chrome/cac-chrome.js");

let pending: Promise<unknown> | null = null;

export function ensureCacChrome() {
  if (typeof customElements === "undefined") return;
  if (customElements.get("cac-header")) return;
  pending ??= import(/* @vite-ignore */ CAC_CHROME_URL);
  return pending;
}

export { CAC_CHROME_URL };
