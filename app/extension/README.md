# Studio tab extension

A tiny browser extension (Chrome, Arc, Edge and other Chromium browsers) that makes Link
Checker's "Studio" links reuse one YouTube Studio tab instead of opening a new tab each time:
a Studio tab already open in the same window (such as the other side of a split view), or one it
opens. Handy with Studio side by side in a split view. In Microsoft Edge, Split View can do this
without an extension: click the link icon between the two addresses.

Without it, each Studio link opens a new tab. Studio sends a `Cross-Origin-Opener-Policy`
header that cuts off the page that opened it, so a website can't reuse or steer an open Studio
tab; only an extension can.

## What it can access

- **Permissions:** `storage` (to remember which tab it uses, until the browser closes), access
  to `studio.youtube.com` (so it can find a Studio tab that's already open; the browser will say
  it can "read and change your data on studio.youtube.com", but it never reads or changes a
  page, it only sees which tabs are on Studio and sends one to a new address), and a content
  script on your Link Checker site only. The browser will say it can "read and change
  your data on" that one site; the script only sets a flag so the app knows it's installed and
  relays "open this Studio link" messages.
- **Tabs:** it reuses one Studio tab in the Link Checker window, or opens one, and changes that
  tab's address. It can't see the address of any tab that isn't on Studio, or read any page.
  The address is checked against
  `https://studio.youtube.com/video/<id>/edit`, so it can't be sent anywhere else.
- It acts only on the app's own Studio buttons. Studio links clicked anywhere else are left
  alone.
- No network requests, no other sites, no data leaves your browser.

## Install

Link Checker builds a copy for its own address: open Help (?) → **Reuse one Studio tab** →
**Download**. Unzip it, open `chrome://extensions`, turn on **Developer mode**, click
**Load unpacked** and choose the unzipped folder. Reload Link Checker.

To build by hand, copy this folder and in `manifest.template.json` replace `__ORIGIN__` with
your Link Checker address (e.g. `https://links.example.com`) and `__NAME__` with its name, then
save it as `manifest.json`.

| File | What |
|---|---|
| `manifest.template.json` | Manifest with the site address left as `__ORIGIN__` |
| `content.js` | Runs on the Link Checker site; relays "open Studio" requests |
| `background.js` | Opens Studio links in the one tab it remembers |
