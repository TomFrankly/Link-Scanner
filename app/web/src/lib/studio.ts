// Links into YouTube Studio. Each opens a new tab: Studio sends a Cross-Origin-Opener-Policy
// header that cuts off the tab that opened it, so another site can't reuse or steer an open
// Studio tab (tested in Chromium: named targets and window.open handles both stop working).

/** The video's details page in YouTube Studio, where its description is edited. */
export const studioUrl = (id: string) => `https://studio.youtube.com/video/${encodeURIComponent(id)}/edit`;
