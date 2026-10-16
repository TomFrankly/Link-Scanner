// Opens YouTube Studio links in one reused tab. The first link goes to a Studio tab that's
// already open in the Link Checker tab's window (e.g. the other side of a split view), or
// else a new tab beside the Link Checker tab. Later links load in that same tab, wherever
// you've moved it, until you close it. Then the next link picks again.
//
// What it can do, and nothing else:
// - find tabs showing YouTube Studio (host permission for studio.youtube.com only, so other
//   tabs' addresses stay hidden from it);
// - open a tab, or change a Studio tab's address, only ever to a YouTube Studio video page
//   (checked below, whatever the request says);
// - remember that tab's id until the browser closes (storage.session).
// It can't read any page or touch any tab that isn't showing Studio.
'use strict';

// A Studio video edit page, and nothing else: https://studio.youtube.com/video/<11-char id>/edit
const STUDIO = /^https:\/\/studio\.youtube\.com\/video\/[\w-]{11}\/edit$/;

// Only requests from this extension's own content script, which runs only on the Link Checker
// site and only relays the app's own Studio buttons. Studio links anywhere else are never touched.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || !sender.tab) return;
  if (msg?.type !== 'open-studio' || typeof msg.url !== 'string' || !STUDIO.test(msg.url)) return;
  openStudio(msg.url, sender.tab);
});

async function openStudio(url, from) {
  const { tabId } = await chrome.storage.session.get('tabId');
  if (typeof tabId === 'number') {
    try {
      // Doesn't switch to the tab: in a split view it's already showing, and elsewhere you
      // may want to stay on the Link Checker tab.
      await chrome.tabs.update(tabId, { url });
      return;
    } catch {
      // The tab was closed; pick another below.
    }
  }
  // A Studio tab already open in the same window, the most recently used one first.
  const open = from ? await chrome.tabs.query({ windowId: from.windowId, url: 'https://studio.youtube.com/*' }) : [];
  const reuse = open.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (reuse?.id !== undefined) {
    await chrome.tabs.update(reuse.id, { url });
    await chrome.storage.session.set({ tabId: reuse.id });
    return;
  }
  const tab = await chrome.tabs.create({ url, ...(from ? { index: from.index + 1, openerTabId: from.id, windowId: from.windowId } : {}) });
  await chrome.storage.session.set({ tabId: tab.id });
}
