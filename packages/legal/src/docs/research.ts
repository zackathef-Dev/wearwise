import type { LegalDoc } from '../types';

export const research: LegalDoc = {
  slug: 'research',
  title: 'Research participation information',
  summary:
    'What the WearWise study is, what taking part involves, the possible risks and benefits, how your information is used, and how to withdraw at any time.',
  audience: 'everyone',
  version: '2026-10-17',
  sections: [
    {
      heading: 'You are invited to take part in a research study',
      blocks: [
        'This information explains the WearWise study so you can decide whether to take part. Please read it carefully. If anything is unclear, or you have questions, contact the study team before you decide: {{studyContact}}.',
        'Taking part is completely voluntary.',
      ],
    },
    {
      heading: 'What the study is about',
      blocks: [
        'WearWise is a proof of concept. The study is testing whether a wearable sensor patch, a phone app and a web dashboard can work together to:',
        {
          list: [
            'Record ECG (heart rhythm), heart rate, blood oxygen (SpO₂), skin temperature, movement and pulse wave.',
            'Detect possible falls, and alert you when a reading stays outside its usual range.',
            'Let you share your readings securely with researchers and clinicians, under your control.',
          ],
        },
        'The study is run by {{name}}. It has been approved by {{ethicsCommittee}} (approval {{ethicsApproval}}). In Australia, human research is reviewed under the National Health and Medical Research Council’s National Statement on Ethical Conduct in Human Research.',
      ],
    },
    {
      heading: 'Who can take part',
      blocks: [
        'Adults aged 18 or older.',
        'If you have an implanted electronic medical device, such as a pacemaker, ask your doctor before you take part.',
      ],
    },
    {
      heading: 'What taking part involves',
      blocks: [
        'If you decide to take part, you will:',
        {
          list: [
            'Create a WearWise account in the app, confirm that you are 18 or older, and give your consent.',
            'Connect the patch to your phone using the 6-digit PIN printed on the patch’s label.',
            'Wear the patch and use the app to make recordings. The app shows your readings, alerts and any possible falls.',
            'If the app detects a possible fall, tell it whether you are OK.',
          ],
        },
        'If you choose, you can also:',
        {
          list: [
            'Share your readings with a researcher or clinician by giving them a one-time share code. You choose which signals to include, and whether to include possible falls.',
            'Switch on “Live view for setup”, which streams your live readings to the people you share with for 30 minutes or for a longer time you choose, up to 8 hours – for example while they check the patch is set up correctly, or during a session they are watching. It switches off automatically, and live readings are not stored. While it is on, they can ask you to start a recording; nothing is recorded unless you agree on your phone.',
          ],
        },
        'The study team will tell you how long they would like you to take part and how often to wear the patch. You can stop at any time.',
      ],
    },
    {
      heading: 'Taking part is voluntary',
      blocks: [
        'You don’t have to take part. If you do, you can withdraw at any time, without giving a reason and without any consequence for you. Deciding not to take part, or to withdraw, won’t affect your relationship with the study team or with {{name}}.',
        'To withdraw, you can do any or all of these:',
        {
          list: [
            'Stop sharing, in the app or on the web dashboard. Access ends immediately.',
            'Stop wearing the patch and using the app.',
            'Delete recording sessions in the app. This deletes them from your phone and from the cloud.',
            'Ask us to delete your account and your information by emailing {{privacyEmail}}. There is no button for this in the app yet.',
          ],
        },
        'You are welcome to tell the study team that you are withdrawing ({{studyContact}}), but you don’t have to.',
        'When we delete your account, we delete the information stored with it in the cloud, unless a law or the study’s ethics approval requires us to keep something. If that applies, we will tell you what and why. Information that has already been included in published, de-identified results can’t be removed. Stopping sharing doesn’t delete copies a researcher or clinician has already downloaded, but our Researcher and clinician terms require them to delete those copies when they are no longer needed.',
      ],
    },
    {
      heading: 'Possible risks and inconveniences',
      blocks: [
        {
          list: [
            'Skin irritation. Wearing the patch and its electrodes may irritate your skin. If it does, stop using the patch and seek advice from your doctor or pharmacist.',
            'Electrical safety. While the ECG electrodes are on your body, the patch must be powered from its battery only, never from a mains-connected USB charger or computer.',
            'Inaccurate readings. Readings can be wrong. This could reassure you when something is wrong, or worry you when nothing is. Blood oxygen (SpO₂) is an uncalibrated estimate, heart rate can be wrong if skin contact is poor, and fall detection can miss falls or raise false alarms.',
            'No monitoring. Nobody watches your readings, alerts or falls, and nobody is on call. Alerts and the fall alarm only work when your phone is nearby with the app running. In an emergency, call 000.',
            'The fall alarm. It sounds and vibrates even when your phone is on silent, unless you switch it off in Settings. This could happen at an inconvenient time.',
            'Privacy. Your readings are health information. We protect them, but no system is completely secure. If you share your readings, the people you share with can see them, and can download copies.',
            'Time and effort. Wearing the patch and using the app takes some of your time.',
          ],
        },
        'There may also be risks that we don’t yet know about. Our Health and safety information explains how to use WearWise safely.',
        'If a reading worries you, talk to your doctor. WearWise does not give medical advice.',
      ],
    },
    {
      heading: 'Possible benefits',
      blocks: [
        'We can’t promise that you will benefit from taking part. You may find it interesting to see your own readings. Your participation will help us learn whether wearable sensors like WearWise can work safely and reliably.',
      ],
    },
    {
      heading: 'How your information is used',
      blocks: [
        'We collect and handle your information as described in our Privacy Policy. In summary:',
        {
          list: [
            'Your readings are stored on your phone in an encrypted database, and in our cloud database in {{hostingRegion}}.',
            'Nobody else sees your readings unless you share them, and you can stop sharing at any time.',
            'Researchers and clinicians you share with must follow our Researcher and clinician terms. These require them to keep your information confidential, use it only for the approved study, and never try to re-identify you.',
            'We keep your information for as long as your account is open and the study requires, as approved by {{ethicsCommittee}}. After that, it is deleted or de-identified.',
          ],
        },
        'We will publish or present the study’s results only in de-identified or combined (aggregate) form. You won’t be identifiable in any publication or presentation. If you would like to know about the results, ask the study team.',
      ],
    },
    {
      heading: 'Your consent',
      blocks: [
        'When you create your account, you confirm that you have read this information and agree to take part. We record when you gave your consent and which version of this information you accepted. If we make an important change, we will ask you again.',
        'You can withdraw your consent at any time, as described above.',
      ],
    },
    {
      heading: 'Questions about the study',
      blocks: ['If you have any questions about the study, contact the study team: {{studyContact}}.'],
    },
    {
      heading: 'Concerns or complaints',
      blocks: [
        'This study has been approved by {{ethicsCommittee}} (approval {{ethicsApproval}}).',
        'If you have a concern or complaint about how the study is being conducted, and you would like to raise it with someone who is not part of the study team, contact {{ethicsCommittee}} at {{ethicsContact}} and quote approval number {{ethicsApproval}}.',
        'For complaints about how your personal information is handled, see the Complaints section of our Privacy Policy.',
      ],
    },
  ],
};
