export type { Variant } from './flags.ts';
export declare const flag: (key: string) => Promise<boolean>, experiment: (key: string) => Promise<import("./flags.ts").Variant>;
