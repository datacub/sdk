type Lang = 'ar' | 'en';
export type CardType = 'choice' | 'thumbs' | 'text' | 'nps' | 'general';
export interface Card {
    lang: Lang;
    type: CardType;
    title: string;
    options?: {
        id: string;
        label: string;
    }[];
    followup?: string | null;
    followupOn?: string[] | null;
}
export interface Look {
    accent: string;
    position: 'end' | 'start';
    theme?: 'light' | 'dark' | 'auto';
}
/** An editor edits the card itself: the same card, with its words as fields. */
export interface Edit {
    title(v: string): void;
    option(id: string, v: string): void;
    add(id: string): void;
    remove(id: string): void;
    followup(v: string): void;
    focus?: string | null;
    ph: {
        title: string;
        option: (n: number) => string;
        add: string;
        remove: string;
        followup: string;
    };
}
interface Client {
    track: (...a: unknown[]) => void;
    identify: (...a: unknown[]) => void;
    reset: (...a: unknown[]) => void;
    consent: {
        grant: (...a: unknown[]) => void;
    };
    ask?: (id: string, o?: {
        into?: Element | string;
    }) => void;
    feedback?: () => void;
    _fb?: () => unknown[];
}
export declare const ICONS: {
    x: string;
    check: string;
    plus: string;
    up: string;
    down: string;
};
export interface Parts {
    css: string;
    title(card: Card, ed: Edit, c: HTMLElement): HTMLElement;
    followup(card: Card, ed: Edit): HTMLElement;
    choices(card: Card, ed: Edit): HTMLElement;
    focus(ed: Edit, c: HTMLElement): void;
}
export declare const parts: Partial<Parts>;
export declare function icon(d: string, box?: number, width?: number): SVGSVGElement;
export declare function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K];
export interface Mounted {
    close(): void;
}
/**
 * One question card inside `root`. `send` stores the answer (it rejects to show a retry); `done`
 * runs once when the card goes away, with whether an answer was sent. With `edit`, the same card
 * is the composer's editor: its words are fields and nothing is sent.
 */
export declare function mount(root: ShadowRoot, card: Card, look: Look, o: {
    send: (choice: string | null, text: string | null) => Promise<void>;
    done?: (answered: boolean) => void;
    preview?: boolean;
    inline?: boolean;
    quiet?: boolean;
    focus?: boolean;
    edit?: Edit;
}): Mounted;
/** Start the widget for this SDK client; the script build calls it with window.datacub. */
export declare function start(datacub: Client): void;
export {};
