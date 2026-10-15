/* A legal document as data, so the phone app and the dashboard render the same text
   with their own components. Text may contain {{tokens}} for the organisation's
   details (org.ts), filled in at render time by fill(). */

export type LegalSlug =
  | 'terms'
  | 'privacy'
  | 'collection-notice'
  | 'health-safety'
  | 'research'
  | 'researcher-terms'
  | 'accessibility';

/** A paragraph, a bulleted list, or a highlighted note. */
export type Block = string | { list: string[] } | { note: string };

export interface LegalSection {
  heading: string;
  blocks: Block[];
}

export interface LegalDoc {
  slug: LegalSlug;
  title: string;
  /** One or two sentences: what this document is, for the index page. */
  summary: string;
  /** Who it is for: everyone, or researchers and clinicians only. */
  audience: 'everyone' | 'staff';
  /** The date this text took effect (YYYY-MM-DD). */
  version: string;
  sections: LegalSection[];
}
