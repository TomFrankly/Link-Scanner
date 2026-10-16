// `__BRAND__` is replaced with a literal object at build time by Vite's `define`, so the
// app's name, logo and repo link can change per deployment without touching the code.
declare const __BRAND__: { name: string; logo: string; repo: string };

/** Build-time branding from app/.env (see .env.example and vite.config.ts). */
export const brand = __BRAND__;
