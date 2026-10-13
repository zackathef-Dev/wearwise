import { accessibility } from './docs/accessibility';
import { collectionNotice } from './docs/collection-notice';
import { healthSafety } from './docs/health-safety';
import { privacy } from './docs/privacy';
import { research } from './docs/research';
import { researcherTerms } from './docs/researcher-terms';
import { terms } from './docs/terms';
import type { LegalDoc, LegalSlug } from './types';

export type { Block, LegalDoc, LegalSection, LegalSlug } from './types';
export { ORG, fill, orgMissing, type OrgDetails } from './org';

/* What someone agrees to when they create an account (or, after a change, the next
   time they sign in): the terms, the privacy policy, the collection notice and the
   research information, at this version. Bump it when any of those changes in a way
   people must accept again; the app and dashboard then ask once more, and the server
   records which version each account accepted (profiles.terms_version). Staff also
   accept the researcher terms at the same version. */
export const ACCEPTANCE_VERSION = '2026-10-17';

/** Every document, in the order the Legal pages list them. */
export const DOCS: readonly LegalDoc[] = [
  terms, privacy, collectionNotice, healthSafety, research, researcherTerms, accessibility,
];

export const docBySlug = (slug: string): LegalDoc | undefined => DOCS.find((d) => d.slug === slug);

/** The documents an account accepts: researcher terms only for staff. */
export const acceptedDocs = (staff: boolean): LegalSlug[] =>
  ['terms', 'privacy', 'collection-notice', 'research', ...(staff ? (['researcher-terms'] as const) : [])];
