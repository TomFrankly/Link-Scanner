// The workspace's planned link fixes, looked up by link and channel. A fix with channelId ''
// applies in every channel; a fix saved for one channel wins over it for that channel's videos.
import type { LinkFix } from './types';

export class FixBook {
  #byUrl = new Map<string, LinkFix[]>();

  constructor(list: LinkFix[]) {
    for (const f of list) {
      const at = this.#byUrl.get(f.url);
      if (at) at.push(f);
      else this.#byUrl.set(f.url, [f]);
    }
    // The every-channel fix first, then per-channel ones.
    for (const fixes of this.#byUrl.values()) fixes.sort((a, b) => a.channelId.localeCompare(b.channelId));
  }

  /** Whether the link has a planned fix in any channel. */
  has(url: string) {
    return this.#byUrl.has(url);
  }

  /** Every planned fix for the link, the every-channel one first. */
  all(url: string): LinkFix[] {
    return this.#byUrl.get(url) ?? [];
  }

  /** The fix that applies to the link in one channel's videos. */
  for(url: string, channelId: string): LinkFix | undefined {
    const fixes = this.all(url);
    return fixes.find((f) => f.channelId === channelId) ?? fixes.find((f) => f.channelId === '');
  }

  /** The fix saved for exactly this scope ('' = every channel). */
  exact(url: string, channelId: string): LinkFix | undefined {
    return this.all(url).find((f) => f.channelId === channelId);
  }
}
