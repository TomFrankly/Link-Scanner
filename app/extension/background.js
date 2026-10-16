// Opens YouTube Studio links in one reused tab. The first link opens a new tab beside the
// Link Checker tab; later links load in that same tab, wherever you've moved it (another
// window, a split view), until you close it. Then the next link opens a new one.
//
// What it can do, and nothing else:
// - open a tab, and change the address of the one tab it opened, only ever to a YouTube Studio
//   video page (checked below, whatever the request says);
// - remember that tab's id until the browser closes (storage.session).
// It can't read any page, see your tabs' addresses, or touch any other tab.
'use strict';

// A Studio video edit page, and nothing else: https://studio.youtube.com/video/<11-char id>/edit
const STUDIO = /^https:\/\/studio\.youtube\.com\/video\/[\w-]{11}\/edit$/;

// Only requests from this extension's own content script, which runs only on the Link Checker
// site and only relays the app's own Studio buttons. Studio links anywhere else, and Studio tabs
// you open yourself, are never touched.
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
      // The tab was closed; open a new one below.
    }
  }
  const tab = await chrome.tabs.create({ url, ...(from ? { index: from.index + 1, openerTabId: from.id, windowId: from.windowId } : {}) });
  await chrome.storage.session.set({ tabId: tab.id });
}
