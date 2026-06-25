/** Options page: store the Mnemosyne API base URL + a write-scoped API key. */
const baseInput = document.getElementById("apiBase") as HTMLInputElement;
const keyInput = document.getElementById("apiKey") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLElement;
const form = document.getElementById("form") as HTMLFormElement;

async function load() {
  const { apiBase = "http://localhost:3000", apiKey = "" } = await chrome.storage.sync.get([
    "apiBase",
    "apiKey",
  ]);
  baseInput.value = String(apiBase);
  keyInput.value = String(apiKey);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await chrome.storage.sync.set({
    apiBase: baseInput.value.trim(),
    apiKey: keyInput.value.trim(),
  });
  statusEl.textContent = "Saved ✓";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});

void load();
