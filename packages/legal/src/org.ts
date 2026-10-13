/* The organisation's details used in every document. Fill these in before launch:
   until every one is set, the documents show a "draft" notice (orgMissing()). They are
   not invented here on purpose: who runs WearWise, and how to reach them, has to come
   from the organisation itself. */

export interface OrgDetails {
  /** The legal entity running WearWise, e.g. "Example Health Research Pty Ltd". */
  name: string | null;
  /** Australian Business Number. */
  abn: string | null;
  /** Postal address for privacy requests and complaints. */
  address: string | null;
  /** Where privacy questions, access/correction and deletion requests go. */
  privacyEmail: string | null;
  /** General support. */
  supportEmail: string | null;
  /** The Human Research Ethics Committee that approved the study, and its approval number. */
  ethicsCommittee: string | null;
  ethicsApproval: string | null;
  /** How to reach the ethics committee's complaints contact (email or phone). */
  ethicsContact: string | null;
  /** Who participants can contact about the study (the lead researcher). */
  studyContact: string | null;
  /** Where the cloud database is hosted, e.g. "Sydney, Australia (AWS ap-southeast-2)". */
  hostingRegion: string | null;
  /** The web dashboard's address, e.g. "https://app.example.org". */
  dashboardUrl: string | null;
  /** The Australian state or territory whose law governs the terms, e.g. "New South Wales". */
  governingLaw: string | null;
}

export const ORG: OrgDetails = {
  name: null,
  abn: null,
  address: null,
  privacyEmail: null,
  supportEmail: null,
  ethicsCommittee: null,
  ethicsApproval: null,
  ethicsContact: null,
  studyContact: null,
  hostingRegion: null,
  dashboardUrl: null,
  governingLaw: null,
};

const LABEL: Record<keyof OrgDetails, string> = {
  name: 'organisation name',
  abn: 'ABN',
  address: 'postal address',
  privacyEmail: 'privacy email',
  supportEmail: 'support email',
  ethicsCommittee: 'ethics committee',
  ethicsApproval: 'ethics approval number',
  ethicsContact: 'ethics committee contact',
  studyContact: 'study contact',
  hostingRegion: 'hosting region',
  dashboardUrl: 'dashboard address',
  governingLaw: 'state or territory',
};

/** Replaces {{name}}, {{privacyEmail}}, … with the organisation's details, or a
    visible [placeholder] while one isn't set yet. */
export function fill(text: string, org: OrgDetails = ORG): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (!(key in LABEL)) return whole;
    const value = org[key as keyof OrgDetails];
    return value ?? `[${LABEL[key as keyof OrgDetails]}]`;
  });
}

/** Details still to be filled in (empty when ready to publish). */
export const orgMissing = (org: OrgDetails = ORG): string[] =>
  (Object.keys(LABEL) as (keyof OrgDetails)[]).filter((k) => !org[k]).map((k) => LABEL[k]);
