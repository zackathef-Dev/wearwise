import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_VERSION, DOCS, TEAM, acceptedDocs, copyrightLine, docBySlug } from '../index';
import { ORG, fill, orgMissing, type OrgDetails } from '../org';
import type { Block, LegalDoc, LegalSlug } from '../types';

const VERSION = '2026-10-17';

const SLUGS: LegalSlug[] = [
  'terms', 'privacy', 'collection-notice', 'health-safety', 'research', 'researcher-terms', 'accessibility',
];

const ORG_KEYS = Object.keys(ORG) as (keyof OrgDetails)[];

const blockText = (b: Block): string[] => (typeof b === 'string' ? [b] : 'list' in b ? b.list : [b.note]);

/** Every piece of text in a document, in reading order. */
const textsOf = (d: LegalDoc): string[] => [
  d.title,
  d.summary,
  ...d.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockText)]),
];

const fullText = (d: LegalDoc): string => textsOf(d).join('\n');

const doc = (slug: LegalSlug): LegalDoc => {
  const d = docBySlug(slug);
  if (!d) throw new Error(`missing document: ${slug}`);
  return d;
};

const unsetOrg = (): OrgDetails =>
  Object.fromEntries(ORG_KEYS.map((k) => [k, null])) as unknown as OrgDetails;

const fullOrg = (): OrgDetails =>
  Object.fromEntries(ORG_KEYS.map((k) => [k, `VALUE_${k}`])) as unknown as OrgDetails;

describe('DOCS', () => {
  it('contains every document exactly once, with a unique slug', () => {
    const slugs = DOCS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect([...slugs].sort()).toEqual([...SLUGS].sort());
  });

  it.each(DOCS.map((d) => [d.slug, d] as const))('%s has the current version', (_slug, d) => {
    expect(d.version).toBe(VERSION);
  });

  it('acceptance version matches the documents', () => {
    expect(ACCEPTANCE_VERSION).toBe(VERSION);
  });

  it.each(DOCS.map((d) => [d.slug, d] as const))('%s has a title, a summary and real sections', (_slug, d) => {
    expect(d.title.trim()).not.toBe('');
    expect(d.summary.trim()).not.toBe('');
    expect(d.sections.length).toBeGreaterThanOrEqual(2);
    for (const s of d.sections) {
      expect(s.heading.trim()).not.toBe('');
      expect(s.blocks.length).toBeGreaterThanOrEqual(1);
      for (const b of s.blocks) {
        if (typeof b === 'object' && 'list' in b) expect(b.list.length).toBeGreaterThanOrEqual(1);
        for (const t of blockText(b)) expect(t.trim()).not.toBe('');
      }
    }
  });

  it.each(DOCS.map((d) => [d.slug, d] as const))('%s has no duplicate section headings', (_slug, d) => {
    const headings = d.sections.map((s) => s.heading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it('only the researcher terms are for staff', () => {
    for (const d of DOCS) expect(d.audience).toBe(d.slug === 'researcher-terms' ? 'staff' : 'everyone');
  });
});

describe('organisation tokens', () => {
  it.each(DOCS.map((d) => [d.slug, d] as const))('%s uses only known tokens', (_slug, d) => {
    const used = [...fullText(d).matchAll(/\{\{(\w*)\}\}/g)].map((m) => m[1]);
    for (const key of used) expect(ORG_KEYS).toContain(key);
  });

  it.each(DOCS.map((d) => [d.slug, d] as const))('%s has no tokens left after fill()', (_slug, d) => {
    for (const t of textsOf(d)) {
      expect(fill(t)).not.toContain('{{');
      expect(fill(t, fullOrg())).not.toContain('{{');
    }
  });
});

describe('required content', () => {
  it('the privacy policy tells people they can complain to the OAIC', () => {
    const text = fullText(doc('privacy'));
    expect(text).toContain('OAIC');
    expect(text).toContain('oaic.gov.au');
  });

  it('the collection notice points to the OAIC too', () => {
    expect(fullText(doc('collection-notice'))).toContain('OAIC');
  });

  it('health and safety says to call 000 in an emergency', () => {
    expect(fullText(doc('health-safety'))).toContain('000');
    const first = doc('health-safety').sections[0];
    expect(first?.blocks).toContainEqual({ note: 'In an emergency, call 000.' });
  });
});

describe('docBySlug / acceptedDocs', () => {
  it('finds every document and nothing else', () => {
    for (const s of SLUGS) expect(docBySlug(s)?.slug).toBe(s);
    expect(docBySlug('nope')).toBeUndefined();
  });

  it('staff also accept the researcher terms', () => {
    expect(acceptedDocs(false)).not.toContain('researcher-terms');
    expect(acceptedDocs(true)).toContain('researcher-terms');
    for (const s of acceptedDocs(true)) expect(docBySlug(s)).toBeDefined();
  });
});

describe('fill / orgMissing', () => {
  it('orgMissing() lists every field when nothing is set', () => {
    expect(orgMissing(unsetOrg())).toHaveLength(ORG_KEYS.length);
  });

  it.runIf(ORG_KEYS.every((k) => ORG[k] === null))('orgMissing() lists every field while ORG is unset', () => {
    expect(orgMissing()).toHaveLength(ORG_KEYS.length);
    expect(orgMissing()).toEqual(orgMissing(unsetOrg()));
  });

  it('orgMissing() is empty once every field is set', () => {
    expect(orgMissing(fullOrg())).toEqual([]);
  });

  it('fill() substitutes provided values', () => {
    const org: OrgDetails = { ...unsetOrg(), name: 'Example Org', privacyEmail: 'privacy@example.org' };
    expect(fill('{{name}} – {{privacyEmail}}', org)).toBe('Example Org – privacy@example.org');
  });

  it('fill() shows a visible placeholder for a value that is not set', () => {
    expect(fill('Contact {{supportEmail}}.', unsetOrg())).toBe('Contact [support email].');
  });

  it('fill() leaves unknown tokens untouched', () => {
    expect(fill('{{notAField}}', fullOrg())).toBe('{{notAField}}');
  });
});

describe('team credits', () => {
  it('names the four members of the WearWise Project Team, each with a role', () => {
    expect(TEAM.name).toBe('WearWise Project Team');
    expect(TEAM.members.map((m) => m.name)).toEqual([
      'Zakiul Atheef', 'Hari Bethelli', 'Siri Bethelli', 'Thevindu Kodagoda Munasinghage',
    ]);
    for (const m of TEAM.members) expect(m.role.trim().length).toBeGreaterThan(0);
  });

  it('matches the licence in LICENSE and gives a copyright line', () => {
    expect(TEAM.licence).toBe('PolyForm Noncommercial 1.0.0');
    expect(copyrightLine()).toBe(`© ${TEAM.year} WearWise Project Team`);
  });
});
