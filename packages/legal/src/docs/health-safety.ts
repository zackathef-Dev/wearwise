import type { LegalDoc } from '../types';

export const healthSafety: LegalDoc = {
  slug: 'health-safety',
  title: 'Health and safety',
  summary:
    'Important safety information for the WearWise patch and app: what they can and can’t do, why you shouldn’t rely on them, and how to wear the patch safely.',
  audience: 'everyone',
  version: '2026-10-17',
  sections: [
    {
      heading: 'In an emergency',
      blocks: [
        { note: 'In an emergency, call 000.' },
        'WearWise does not call for help. Nobody watches your readings, alerts or falls, and nobody is on call.',
        'If you are worried about your health and it is not an emergency, contact your doctor or another health professional.',
      ],
    },
    {
      heading: 'WearWise is not a medical device',
      blocks: [
        'WearWise is a research proof of concept. It is not a medical device registered with the Therapeutic Goods Administration (TGA).',
        {
          list: [
            'It does not diagnose or treat any condition.',
            'It does not give medical advice.',
            'Its readings are research measurements, not medical test results.',
          ],
        },
        'Don’t start, stop or change any treatment or medicine because of a WearWise reading. Talk to your doctor.',
      ],
    },
    {
      heading: 'Readings may be wrong',
      blocks: [
        'WearWise readings can be inaccurate. In particular:',
        {
          list: [
            'Blood oxygen (SpO₂) is an uncalibrated estimate. Don’t use it to check your oxygen level.',
            'Heart rate can be wrong if the patch doesn’t have good contact with your skin.',
            'The ECG trace is not a diagnostic ECG. Don’t use it to check for heart problems.',
            'Skin temperature is not the same as your body temperature, so it can’t tell you whether you have a fever.',
            'Fall detection can miss a real fall, and it can raise an alarm when you haven’t fallen.',
          ],
        },
        'A normal-looking reading doesn’t mean you are well, and an unusual reading doesn’t necessarily mean something is wrong.',
      ],
    },
    {
      heading: 'Alerts and the fall alarm',
      blocks: [
        'The app can notify you when a reading stays outside its usual range, when there may have been a fall, and when the patch disconnects during a recording.',
        {
          list: [
            'Alerts and the fall alarm only work when your phone is nearby with the WearWise app running.',
            'On iPhone, notifications are only shown while the app is running.',
            'Nobody monitors alerts or falls for you, and they are no substitute for emergency services.',
            'The fall alarm sounds and vibrates, even when your phone is on silent, unless you switch it off in Settings.',
          ],
        },
        { note: 'Don’t rely on WearWise to get help. In an emergency, call 000.' },
      ],
    },
    {
      heading: 'Electrical safety',
      blocks: [
        'While the ECG electrodes are on your body, power the patch from its battery only.',
        'Never connect the patch to a mains-connected USB charger, a computer, or anything else plugged into the wall while you are wearing it. Take the patch off before you plug a cable into it.',
      ],
    },
    {
      heading: 'Your skin',
      blocks: [
        'If your skin becomes irritated where you wear the patch – for example, red, itchy, sore or blistered – stop using the patch and seek advice from your doctor or pharmacist.',
        'Please also let the study team know: {{studyContact}}.',
      ],
    },
    {
      heading: 'Implanted medical devices',
      blocks: [
        'If you have an implanted electronic medical device, such as a pacemaker or an implantable defibrillator, ask your doctor before you use the patch.',
      ],
    },
    {
      heading: 'Looking after the patch',
      blocks: [
        {
          list: [
            'Don’t open or modify the patch.',
            'Follow any instructions the study team gives you about wearing, charging and caring for the patch.',
            'If the patch seems damaged or isn’t working properly, stop using it and contact {{supportEmail}}.',
          ],
        },
      ],
    },
    {
      heading: 'Reporting a problem',
      blocks: [
        'If you have a health problem that you think may be related to wearing the patch, contact your doctor and tell the study team: {{studyContact}}.',
        'For technical problems with the patch, the app or the dashboard, contact {{supportEmail}}.',
      ],
    },
  ],
};
