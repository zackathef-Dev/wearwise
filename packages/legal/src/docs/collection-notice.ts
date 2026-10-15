import type { LegalDoc } from '../types';

export const collectionNotice: LegalDoc = {
  slug: 'collection-notice',
  title: 'Collection Notice',
  summary:
    'A short notice, shown when you sign up, about the personal information WearWise collects and why. Our Privacy Policy has the full details.',
  audience: 'everyone',
  version: '2026-10-17',
  sections: [
    {
      heading: 'Who is collecting your information',
      blocks: [
        'WearWise is run by {{name}} (ABN {{abn}}). You can contact us about privacy at {{privacyEmail}} or {{address}}.',
      ],
    },
    {
      heading: 'What we collect',
      blocks: [
        {
          list: [
            'Account details: your name, email address and password (stored only as a secure hash), when you gave consent, your confirmation that you are 18 or older, and which version of our terms you accepted.',
            'Health readings from your patch: ECG, heart rate, blood oxygen (SpO₂), skin temperature, movement and pulse wave.',
            'Recording details, such as start and end times, the patch’s name, identifier and firmware version, and how it connected.',
            'Possible falls, and whether you said you were OK.',
            'Alerts when a reading stayed outside its usual range.',
          ],
        },
        'Health information is sensitive information. We only collect it with your consent.',
        'Your date of birth, height, weight, profile photo, your patch’s Wi-Fi password and your app settings stay on your phone. We never receive them.',
      ],
    },
    {
      heading: 'Why we collect it',
      blocks: [
        'To run your account and the app, show and sync your readings, share them with the people you choose, send sign-up and password-reset emails, keep WearWise secure, and carry out the research study. We only publish study results in a form that does not identify you.',
        'No law requires you to give us this information.',
      ],
    },
    {
      heading: 'If you don’t provide it',
      blocks: [
        'If you don’t provide your account details and consent, you can’t create an account or take part in the study. Your date of birth, height and weight are optional. Without them, the usual ranges for your readings are less personalised.',
      ],
    },
    {
      heading: 'Who we disclose it to',
      blocks: [
        {
          list: [
            'The researchers and clinicians you choose to share with, using a share code. Nobody else sees your readings unless you share them. You choose what they see, and you can stop sharing at any time.',
            'Our service providers: Supabase (database, sign-in, file storage and real-time messaging), our email provider and our web host.',
            'Anyone a law requires us to disclose it to.',
          ],
        },
        'We don’t sell your information or use it for advertising.',
      ],
    },
    {
      heading: 'Overseas',
      blocks: [
        'Your cloud data is stored in {{hostingRegion}}. Some service providers, such as our email provider, may process limited information, such as your email address, outside Australia.',
      ],
    },
    {
      heading: 'Access, correction and complaints',
      blocks: [
        'Our Privacy Policy explains how to see or correct your information, how to ask us to delete it, and how to complain. If you are not satisfied with how we handle a complaint, you can contact the Office of the Australian Information Commissioner (OAIC) at oaic.gov.au or on 1300 363 992.',
      ],
    },
  ],
};
