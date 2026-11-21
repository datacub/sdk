type Client = {
    _fb?: () => unknown[];
} | unknown[] | undefined;
export type Variant = 'A' | 'B';
export declare function makeFlags(client: () => Client): {
    flag: (key: string) => Promise<boolean>;
    experiment: (key: string) => Promise<Variant>;
};
export {};
