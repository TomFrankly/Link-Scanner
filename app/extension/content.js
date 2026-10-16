// Runs only on the Link Checker site (the one origin in manifest.json). It tells the page the
// extension is installed, and passes on one kind of request: "open this YouTube Studio link".
// The page can't reach the extension directly, so it posts a window message that this relays.
'use strict';

document.documentElement.dataset.studioTab = '1';

window.addEventListener('message', (e) => {
  // Only messages the page sent to itself, in the expected shape.
  if (e.source !== window || e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || msg.type !== 'link-checker:open-studio' || typeof msg.url !== 'string') return;
  chrome.runtime.sendMessage({ type: 'open-studio', url: msg.url });
});
