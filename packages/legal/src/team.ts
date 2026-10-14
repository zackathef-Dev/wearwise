/* Who made WearWise. One source for the credits in the app (Profile → Legal & privacy),
   the dashboard (the Legal page and every footer) and TEAM.md / README, which repeat it in
   prose. The licence named here is the one in LICENSE at the repository root. */

export interface TeamMember {
  name: string;
  role: string;
}

export interface Team {
  name: string;
  year: number;
  /** Where the project comes from. */
  project: string;
  /** SPDX name of the licence in LICENSE. */
  licence: string;
  /** One line on what the licence allows. */
  licenceSummary: string;
  members: readonly TeamMember[];
}

export const TEAM: Team = {
  name: 'WearWise Project Team',
  year: 2026,
  project: 'La Trobe University CSE3CAP Capstone Project',
  licence: 'PolyForm Noncommercial 1.0.0',
  licenceSummary: 'Free to use, copy and change for noncommercial purposes. Not for sale.',
  members: [
    { name: 'Zakiul Atheef', role: 'Project Lead, Scrum Master, Technical Lead, Security Engineering Lead and Integration Lead' },
    { name: 'Hari Bethelli', role: 'Cloud & Data Engineer' },
    { name: 'Siri Bethelli', role: 'UI/UX & Data Visualisation Engineer' },
    { name: 'Thevindu Kodagoda Munasinghage', role: 'Security Engineer, Documentation Lead and QA & Testing Lead' },
  ],
};

/** "© 2026 WearWise Project Team" */
export const copyrightLine = (): string => `© ${TEAM.year} ${TEAM.name}`;
