export declare const TURNSTILE_ORIGIN: string;
export declare function originOf(url: string | null | undefined): string | null;
export declare function styleHash(css: string): string;
export declare function appCsp(o?: { supabaseUrl?: string; tileUrls?: string[]; turnstile?: boolean; meta?: boolean }): string;
export declare function listingCsp(o?: { supabaseUrl?: string; styleHashes?: string[]; meta?: boolean }): string;
export declare function cspMeta(policy: string): string;
export declare function renderHeaders(template: string, policies: { app: string; listing: string }): string;
