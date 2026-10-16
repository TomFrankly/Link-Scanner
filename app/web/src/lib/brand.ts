declare const __BRAND__: { name: string; logo: string };

/** Build-time branding from app/.env (see .env.example and vite.config.ts). */
export const brand = __BRAND__;
