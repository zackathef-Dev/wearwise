import type { LegalDoc } from '../types';

export const researcherTerms: LegalDoc = {
  slug: 'researcher-terms',
  title: 'Researcher and clinician terms',
  summary:
    'Extra terms for researchers and clinicians who use the WearWise dashboard: how you may access, use, store and protect the information participants share with you.',
  audience: 'staff',
  version: '2026-10-17',
  sections: [
    {
      heading: 'Who these terms are for',
      blocks: [
        'These terms apply to you if you have a WearWise researcher or clinician (“staff”) account. Staff accounts are created by a WearWise administrator.',
        'They apply in addition to our Terms of Use and Privacy Policy. You must accept them before you can see any participant’s information, and we record which version you accepted.',
        {
          note: 'Participants trust you with their health information. Use it only for the approved study, keep it confidential, and respect their choices.',
        },
      ],
    },
    {
      heading: 'What you can see',
      blocks: [
        'You can only see what a participant has chosen to share with you. A participant shares by creating a one-time share code in the app and giving it to you. They choose which signals to include, and whether to include possible falls.',
        {
          list: [
            'Participants can see who has access to their information, and stop sharing at any time. Your access then ends immediately.',
            'A participant can switch on “Live view for setup” to stream live readings to you for a time they choose, from 30 minutes up to 8 hours. It switches off automatically, and live readings are not stored. While it is on, you can ask the participant to start a recording, which starts only if they agree on their phone, and stop a recording you asked for.',
            'You can download a participant’s shared recordings as a spreadsheet file (CSV).',
          ],
        },
      ],
    },
    {
      heading: 'Use information only for the approved study',
      blocks: [
        {
          list: [
            'Access participants’ information only for the purpose of the study approved by {{ethicsCommittee}} (approval {{ethicsApproval}}), and only as the study protocol allows.',
            'Only use share codes that participants have given you themselves.',
            'Don’t ask participants to share more than the study needs.',
            'Don’t look at information out of curiosity, or for any purpose other than the study.',
          ],
        },
      ],
    },
    {
      heading: 'Keep it confidential',
      blocks: [
        {
          list: [
            'Don’t disclose participants’ information to anyone who is not part of the approved study team.',
            'Don’t discuss information that could identify a participant where others can hear or see it.',
            'Only publish or present results in de-identified or combined (aggregate) form.',
          ],
        },
      ],
    },
    {
      heading: 'No re-identification or data linkage',
      blocks: [
        {
          list: [
            'Don’t try to identify a participant from de-identified or combined information.',
            'Don’t link WearWise information with any other dataset, unless the study’s ethics approval allows it.',
          ],
        },
      ],
    },
    {
      heading: 'Downloads',
      blocks: [
        'When you download recordings as CSV files, the copies are no longer protected by WearWise. You are responsible for them.',
        {
          list: [
            'Save downloads only to secure storage that is approved for the study.',
            'Don’t keep downloads on personal devices, personal cloud accounts, removable drives or email, unless the study protocol and your institution allow it.',
            'Delete downloads when they are no longer needed for the study.',
          ],
        },
      ],
    },
    {
      heading: 'Live view is for setup checks',
      blocks: [
        'Live view lets you check that a participant’s patch is set up and working. Don’t record, screenshot or photograph live readings unless the study protocol allows it.',
      ],
    },
    {
      heading: 'When a participant stops sharing',
      blocks: [
        'A participant can stop sharing at any time, without giving a reason. When they do, your access ends immediately.',
        {
          list: [
            'Respect their decision. Don’t try to get their information another way, or pressure them to share again.',
            'Handle any copies you have already downloaded as the study protocol requires for participants who withdraw.',
          ],
        },
      ],
    },
    {
      heading: 'Secure your account and devices',
      blocks: [
        {
          list: [
            'Use a strong password that you don’t use anywhere else, and keep it private.',
            'Don’t share your account. Everyone who needs access must have their own staff account.',
            'Lock your computer and other devices when you step away, and keep their software up to date.',
            'The dashboard keeps you signed in using your browser’s local storage. Sign out when you have finished, especially on a shared computer.',
            'When you no longer need access, for example when your role in the study ends, tell the study team so your account can be closed.',
          ],
        },
      ],
    },
    {
      heading: 'Report problems immediately',
      blocks: [
        'Report any of the following to {{privacyEmail}} immediately, and in any case within 24 hours of becoming aware of it:',
        {
          list: [
            'A suspected data breach, or access to information by someone who shouldn’t have it.',
            'Misuse of WearWise or of participants’ information.',
            'A lost or stolen device that holds downloads or is signed in to the dashboard.',
            'Someone else knowing your password.',
            'A security weakness in WearWise.',
          ],
        },
        'Help us investigate, and follow our instructions to contain the problem.',
      ],
    },
    {
      heading: 'WearWise is not a monitoring service',
      blocks: [
        {
          note: 'WearWise does not provide monitoring, and nobody is on call. Its alerts are not a substitute for clinical monitoring.',
        },
        {
          list: [
            'WearWise is not a registered medical device. Readings are research measurements and may be inaccurate. Don’t rely on them for clinical decisions.',
            'The dashboard can only notify you about alerts while it is open in your browser.',
            'Fall detection can miss falls and raise false alarms.',
            'If you become aware that a participant may need urgent help, follow your professional obligations and the study protocol. In an emergency, call 000.',
          ],
        },
      ],
    },
    {
      heading: 'Laws and policies you must follow',
      blocks: [
        'When you use WearWise, you must comply with:',
        {
          list: [
            'The Privacy Act 1988 (Cth), including the Australian Privacy Principles.',
            'The study’s ethics approval from {{ethicsCommittee}}, and the approved study protocol.',
            'The National Health and Medical Research Council’s National Statement on Ethical Conduct in Human Research.',
            'Your institution’s policies and your professional obligations.',
          ],
        },
      ],
    },
    {
      heading: 'If these terms are broken',
      blocks: [
        'We may suspend or remove your access at any time if you break these terms, if we need to protect participants’ information, or when the study ends.',
        'We may also report a serious breach to {{ethicsCommittee}} and to your institution.',
      ],
    },
    {
      heading: 'Contact',
      blocks: [
        {
          list: [
            'Report a breach or misuse, or ask a privacy question: {{privacyEmail}}',
            'Questions about the study: {{studyContact}}',
            'Technical support: {{supportEmail}}',
          ],
        },
      ],
    },
  ],
};
