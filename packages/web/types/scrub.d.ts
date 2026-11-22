/** Redactions and drops since the last event; sent as $dropped_count, never with the values. */
export declare const tally: {
    n: number;
};
export declare const toAscii: (s: string) => string;
export declare const digitsOnly: (s: string) => string;
export declare function scrub(s: string): string;
export declare function text(v: string, max?: number): string;
export declare const badText: (s: string) => boolean;
export declare function badKey(k: string, top: boolean): boolean;
export declare function clean(v: unknown, depth?: number): unknown;
export declare function segment(seg: string): string;
export interface Url {
    url: string;
    path: string;
    utm?: Record<string, string>;
    click_id_type?: string;
    q?: Record<string, string>;
}
export declare const code: (v: string) => boolean;
export declare const label: (v: string, max: number) => string;
export declare function cleanUrl(href: string, hashRouting?: boolean, query?: boolean): Url | null;
export declare function eventName(name: string): string | null;
export declare function validId(v: unknown, own: string[]): string | null;
