// datacub web SDK 0.6.0, for the script tag. Save as datacub.d.ts in your project: `datacub` is then typed.
export declare const VERSION = "0.6.0";
export type Property = string | number | boolean | null | Date | Property[] | {
    [key: string]: Property;
};
export type Properties = Record<string, Property>;
/**
 * How the card looks: set in datacub (Feedback, Appearance), or in code with
 * `datacub.init(id, { feedback: { look } })`, which wins. Every value is checked; one that is not a
 * known word or a #rrggbb colour is ignored, and colours that would be hard to read are replaced.
 */
export interface FeedbackLook {
    /** the brand colour: buttons, the chosen answer, focus rings. #rrggbb */
    accent?: string;
    /** the bottom corner: 'end' right, 'start' left */
    position?: 'end' | 'start';
    /** 'auto' follows the visitor's system */
    theme?: 'light' | 'dark' | 'auto';
    /** 'site' uses the page's own font */
    font?: 'system' | 'site' | 'serif' | 'rounded';
    /** default 'medium' */
    radius?: 'none' | 'small' | 'medium' | 'large';
    size?: 'small' | 'medium' | 'large';
    /** card colour, in place of the theme's. #rrggbb */
    background?: string | null;
    /** text colour; ignored when it does not read well on the card. #rrggbb */
    text?: string | null;
    /** the question's colour. #rrggbb */
    title?: string | null;
    /** answer buttons: fill, words, edge. #rrggbb */
    option?: string | null;
    optionText?: string | null;
    optionBorder?: string | null;
    /** the chosen answer, in place of the brand colour. #rrggbb */
    selected?: string | null;
    /** the send button and its words, in place of the brand colour. #rrggbb */
    button?: string | null;
    buttonText?: string | null;
    /** the close icon. #rrggbb */
    close?: string | null;
    /** the card's edge colour and width, 0 to 4 px. #rrggbb */
    border?: string | null;
    borderWidth?: number | null;
    /** default 'soft': a faint one */
    shadow?: 'none' | 'soft' | 'medium' | 'strong';
    /** card width, 280 to 480 px, in place of the size's */
    width?: number | null;
    /** space inside the card */
    density?: 'compact' | 'regular' | 'roomy';
    /** with font 'custom': a font your page already loads, letters, digits, spaces and hyphens only */
    fontName?: string | null;
    titleSize?: 'small' | 'regular' | 'large';
    titleWeight?: 'regular' | 'medium' | 'semibold' | 'bold';
    bodyWeight?: 'regular' | 'medium' | 'semibold';
    align?: 'start' | 'center';
    /** the yes and no buttons */
    icons?: 'thumbs' | 'faces' | 'emoji' | 'words';
    /** 0 to 10 scores: 'traffic' tints 0 to 6 red, 7 and 8 amber, 9 and 10 green */
    scale?: 'plain' | 'traffic';
    animation?: 'rise' | 'fade' | 'slide' | 'none';
    /** distance from the side and the bottom of the window, 0 to 160 px (phones keep 12 px at the sides) */
    offsetX?: number;
    offsetY?: number;
    /** 'top' above everything, 'high' above most of a page, 'normal' under the page's own popups */
    layer?: 'top' | 'high' | 'normal';
    /** with theme 'auto': the colours for visitors in dark mode (the brand colour carries over); the colours above are for light mode */
    dark?: FeedbackColors | null;
}
/** The colours that have a dark mode version. #rrggbb */
export interface FeedbackColors {
    accent?: string | null;
    background?: string | null;
    text?: string | null;
    title?: string | null;
    option?: string | null;
    optionText?: string | null;
    optionBorder?: string | null;
    selected?: string | null;
    button?: string | null;
    buttonText?: string | null;
    close?: string | null;
    border?: string | null;
}
export interface InitOptions {
    /** Ingestion origin or first-party proxy path. Default https://in.datacub.to */
    apiHost?: string;
    /** Treat `#/route` fragments as routes. Default false. */
    hashRouting?: boolean;
    /** Clicks and form submits. Default true. Pageviews and page leaves are always on. */
    autocapture?: boolean;
    /** Rage clicks: 3 quick clicks in a row (the browser's own click count). Default true; needs autocapture. */
    rageClicks?: boolean;
    /** Your app version or deployment ID, sent as context.release. */
    release?: string;
    /**
     * Store and send nothing until datacub.consent.grant(). Default false: tracking starts at once.
     * Turn it on with "Ask for consent first" in the project's settings, which makes datacub refuse events
     * sent without a grant.
     */
    requireConsent?: boolean;
    /**
     * The insights module (Web Vitals, long tasks, resource totals, form field details, device
     * model), loaded after tracking starts from apiHost. Default true.
     */
    insights?: boolean;
    /**
     * The feedback widget, loaded from apiHost only when the project has a live question or the page
     * opens the "Send feedback" card, and only while tracking. Default true; false never loads it
     * (data-feedback="off" on the script tag). `{ look }` styles the card in code, over the look set
     * in datacub: `{ look: { theme: 'dark', font: 'site', radius: 'small' } }`.
     */
    feedback?: boolean | {
        look?: FeedbackLook;
    };
    /** Turn kinds of capture off on this site. The project's settings in datacub can turn them off too. */
    capture?: Capture;
}
export interface Capture {
    /** Text of clicked buttons and links. */
    text?: boolean;
    /** Page titles. */
    title?: boolean;
    /** URL query values. */
    query?: boolean;
    /** JavaScript errors and failed resources. */
    errors?: boolean;
    /** Failed and slow fetch and XMLHttpRequest calls. */
    network?: boolean;
    /** Form start, invalid submit and field details. */
    forms?: boolean;
}
/**
 * Who the user is, beyond the ID. email, name and phone are shown on their profile and are
 * searchable; they never link two people. Any other key is a user property and passes the same
 * privacy rules as track() properties.
 */
export interface IdentifyOptions {
    /** Opaque workspace or organisation ID. Never a name or email. */
    account?: string | number;
    email?: string;
    name?: string;
    phone?: string;
    [trait: string]: Property | undefined;
}
export interface GrantOptions {
    method?: 'banner' | 'settings' | 'api' | 'cmp';
    /** The customer's privacy notice version, at most 64 characters. */
    policyVersion?: string;
    /** Only from an explicit user action: lets a grant override Global Privacy Control. */
    overrideGPC?: boolean;
}
export interface DatacubClient {
    init(publicKey: string, options?: InitOptions): void;
    track(event: string, properties?: Properties): void;
    identify(userId: string | number, options?: IdentifyOptions): void;
    /** The same with the id inside: identify({ id: 'u_42', email, plan: 'pro' }). */
    identify(profile: IdentifyOptions & {
        id?: string | number;
        userId?: string | number;
        user_id?: string | number;
    }): void;
    reset(): void;
    consent: {
        grant(options?: GrantOptions): void;
        revoke(): void;
    };
    /** Show one question now (the feedback widget loads first when it is not on the page yet). */
    ask?(questionId: string, options?: {
        into?: Element | string;
    }): void;
    /** Open the "Send feedback" card (the feedback widget loads first when it is not on the page yet). */
    feedback?(): void;
    /**
     * Added by the script-tag flags module (/v1/flags.js; with npm, import flag from @datacub/web/flags): is this feature flag on for this
     * visitor? false when it is off, unknown, or cannot be decided (before consent, offline).
     */
    flag?(key: string): Promise<boolean>;
    /**
     * Added by the flags module: this visitor's version of an experiment, 'A' (the original) or 'B'.
     * Records that they saw it. 'A' when it is not running or cannot be decided.
     */
    experiment?(key: string): Promise<'A' | 'B'>;
    /** @internal the feedback and flags modules' way in */
    _fb(): unknown[];
}
declare global {
    var datacub: DatacubClient;
}
