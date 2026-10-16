// Links into YouTube Studio. Studio sends a Cross-Origin-Opener-Policy header that cuts off the
// tab that opened it, so a website can't reuse or steer an open Studio tab (tested in Chromium:
// named targets and window.open handles both stop working). Without help, each link opens a
// new tab. With the optional Studio tab extension (app/extension) installed, links go through
// it instead, and load in one reused tab.

/** The video's details page in YouTube Studio, where its description is edited. */
export const studioUrl = (id: string) => `https://studio.youtube.com/video/${encodeURIComponent(id)}/edit`;

/** Whether the Studio tab extension is installed: its content script marks the page. */
export const hasStudioTab = () => document.documentElement.dataset.studioTab === '1';

/** Opens a video in Studio: in the extension's reused tab when it's installed, else a new tab. */
export function openStudio(id: string) {
  if (hasStudioTab()) window.postMessage({ type: 'link-checker:open-studio', url: studioUrl(id) }, location.origin);
  else window.open(studioUrl(id), '_blank', 'noreferrer');
}

/**
 * Svelte action for Studio links (`<a href={studioUrl(id)} use:studioLink>`): a plain click goes
 * through openStudio; a click with a modifier key, or a middle click, behaves like a normal link.
 */
export function studioLink(node: HTMLAnchorElement) {
  const onclick = (e: MouseEvent) => {
    if (!hasStudioTab() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const id = node.href.match(/\/video\/([^/]+)\/edit/)?.[1];
    if (!id) return;
    e.preventDefault();
    openStudio(decodeURIComponent(id));
  };
  node.addEventListener('click', onclick);
  return { destroy: () => node.removeEventListener('click', onclick) };
}
