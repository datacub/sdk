export declare function bucket(seed: string, id: string): number;
/** Is a flag on for this visitor? rollout is a whole percentage. Raising it only adds visitors. */
export declare const flagOn: (key: string, rollout: number, id: string) => boolean;
/** An experiment's version for this visitor: 50/50, seeded by the experiment's id, so a new
 * experiment under an old key starts a fresh split. */
export declare const variantOf: (experimentId: string, id: string) => 'A' | 'B';
