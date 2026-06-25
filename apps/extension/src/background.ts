/**
 * Mnemosyne MV3 background service worker. Adds a toolbar button + right-click menus to
 * save the current page or a selection to the second brain via POST {apiBase}/api/capture
 * with a long-lived API key (write scope) configured on the options page.
 */
interface Settings {
  apiBase: string;
  apiKey: string;
}

async function getSettings(): Promise<Settings> {
  const { apiBase = "http://localhost:3000", apiKey = "" } = await chrome.storage.sync.get([
    "apiBase",
    "apiKey",
  ]);
  return { apiBase: String(apiBase).replace(/\/$/, ""), apiKey: String(apiKey) };
}

async function capture(payload: { url?: string; text?: string; title?: string; note?: string }) {
  const { apiBase, apiKey } = await getSettings();
  if (!apiKey) {
    notify("Set your API key in the Mnemosyne extension options first.");
    return;
  }
  try {
    const res = await fetch(`${apiBase}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    notify(res.ok ? "Saved to Mnemosyne ✓" : `Save failed (${res.status})`);
  } catch (e) {
    notify(`Save failed: ${(e as Error).message}`);
  }
}

function notify(message: string) {
  chrome.notifications?.create({
    type: "basic",
    iconUrl: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    title: "Mnemosyne",
    message,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "save-page", title: "Save page to Mnemosyne", contexts: ["page"] });
  chrome.contextMenus.create({
    id: "save-selection",
    title: "Save selection to Mnemosyne",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-selection" && info.selectionText) {
    void capture({
      text: info.selectionText,
      title: tab?.title,
      note: tab?.url ? `Selected from ${tab.url}` : undefined,
    });
  } else if (info.menuItemId === "save-page" && tab?.url) {
    void capture({ url: tab.url, title: tab.title });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.url) void capture({ url: tab.url, title: tab.title });
});
