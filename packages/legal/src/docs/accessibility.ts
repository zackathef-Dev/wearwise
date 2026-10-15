import type { LegalDoc } from '../types';

export const accessibility: LegalDoc = {
  slug: 'accessibility',
  title: 'Accessibility statement',
  summary:
    'How we are making WearWise usable for everyone, what works today, what we know still needs work, and how to tell us about a barrier.',
  audience: 'everyone',
  version: '2026-10-17',
  sections: [
    {
      heading: 'Our commitment',
      blocks: [
        'We want everyone to be able to use WearWise, including people with disability and people who use assistive technology. This statement covers the WearWise phone app and the web dashboard.',
      ],
    },
    {
      heading: 'The standard we aim for',
      blocks: [
        'We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA.',
        'WearWise has not been certified against WCAG. Some parts may not yet fully meet the standard. This statement describes what we have built so far and the limitations we know about.',
      ],
    },
    {
      heading: 'What we have built',
      blocks: [
        {
          list: [
            'Screen reader labels: buttons, icons and other controls are labelled for screen readers.',
            'Text scaling: text grows when you increase the text size on your device or browser.',
            'Reduced motion: WearWise respects your device’s setting to reduce motion.',
            'Not just colour: status is shown in words, not only by colour.',
            'Large touch targets: we design buttons and controls in the phone app to be at least 44 by 44 points.',
            'Light and dark themes.',
            'Keyboard use: you can use the web dashboard with a keyboard.',
            'Table views: on the web dashboard, you can view chart data as a table.',
            'Alerts you can feel and hear: the fall alarm sounds and vibrates. You can turn notifications, sound and vibration on or off in the app’s settings.',
          ],
        },
      ],
    },
    {
      heading: 'Known limitations',
      blocks: [
        {
          list: [
            'Charts and live waveforms, such as the ECG trace, are visual and can be hard to follow with a screen reader. The web dashboard offers table views of chart data.',
            'The patch has no screen. Its 6-digit PIN, which you need to connect it to your phone, is printed on a label that may be hard to read. If you need help reading the PIN or connecting the patch, contact us or the study team.',
          ],
        },
        'There may be other barriers we don’t know about yet. Please tell us if you find one.',
      ],
    },
    {
      heading: 'Feedback and help',
      blocks: [
        'If something in WearWise is hard to use, or you need information in a different format, contact us at {{supportEmail}}. It helps if you tell us:',
        {
          list: [
            'Which screen or page you were using.',
            'What you were trying to do.',
            'Your device and, if you use one, your assistive technology (for example, a screen reader).',
          ],
        },
        'If you are not satisfied with our response, you can contact the Australian Human Rights Commission (humanrights.gov.au).',
      ],
    },
    {
      heading: 'About this statement',
      blocks: [
        'Each version of this statement has a date. We will update it as WearWise changes.',
      ],
    },
  ],
};
