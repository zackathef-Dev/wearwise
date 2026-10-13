import type { LegalDoc } from '../types';

export const terms: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Use',
  summary:
    'The rules for using WearWise – the sensor patch, the phone app and the web dashboard – and what you and we each agree to.',
  audience: 'everyone',
  version: '2026-10-17',
  sections: [
    {
      heading: 'About these terms',
      blocks: [
        'These terms apply when you use WearWise: the wearable sensor patch, the WearWise phone app (iPhone and Android) and the WearWise web dashboard. “We”, “us” and “our” mean {{name}} (ABN {{abn}}), which runs WearWise. “You” means the person using it.',
        'You agree to these terms when you create an account, or when you accept a new version after we change them. They work together with our Privacy Policy, Collection Notice, Health and safety information and Research participation information. If you are a researcher or clinician, our Researcher and clinician terms also apply to you.',
        'If you don’t agree to these terms, please don’t use WearWise.',
      ],
    },
    {
      heading: 'WearWise is a research proof of concept',
      blocks: [
        'WearWise is part of a research study. It is a proof of concept: we are testing whether a wearable patch, a phone app and a web dashboard can record body measurements and let you share them safely.',
        'Because it is a research project:',
        {
          list: [
            'Features may change, be added or be removed while the study runs.',
            'WearWise may sometimes be unavailable, slow or not work as expected.',
            'We may stop WearWise, for example when the study ends. Where we can, we will tell you before that happens.',
          ],
        },
        'We don’t promise that WearWise will always be available or free of errors.',
      ],
    },
    {
      heading: 'Not medical advice',
      blocks: [
        {
          note: 'WearWise is not a medical device. It does not diagnose or treat any condition, and it does not give medical advice. In an emergency, call 000.',
        },
        'Readings are research measurements and may be wrong. Alerts and fall detection can miss things or go off when nothing is wrong, and nobody watches them for you.',
        'Don’t use WearWise to make decisions about your health or treatment. Talk to a doctor or other health professional instead.',
        'Our Health and safety information explains this in more detail. Please read it before you wear the patch.',
      ],
    },
    {
      heading: 'Who can use WearWise',
      blocks: [
        'You must be 18 or older. When you sign up, you must confirm that you are. You can’t create an account without doing so.',
        'There are two kinds of account:',
        {
          list: [
            'Participants wear the patch and use the phone app. You create your own participant account.',
            'Researchers and clinicians (“staff”) use the web dashboard to see information that participants have chosen to share with them. A WearWise administrator creates staff accounts. You can’t create one yourself.',
          ],
        },
      ],
    },
    {
      heading: 'Your account and keeping it secure',
      blocks: [
        'Give us accurate details when you sign up, and use an email address you can get to. We use it to confirm your account and to let you reset your password.',
        'To keep your account and your readings safe:',
        {
          list: [
            'Keep your password private, and don’t use it for other services.',
            'Keep your patch’s 6-digit PIN private. The PIN is printed on the patch’s label and is needed to connect a phone to the patch. Don’t post or share photos of the label.',
            'Don’t let anyone else use your account, and don’t use anyone else’s.',
            'Use a screen lock on your phone and on any computer you use for the dashboard.',
            'Tell us straight away at {{supportEmail}} if you think someone else has used your account or knows your PIN.',
          ],
        },
      ],
    },
    {
      heading: 'Using WearWise properly',
      blocks: [
        'When you use WearWise, you must not:',
        {
          list: [
            'Use it in a way that breaks the law or could harm anyone.',
            'Try to get around, test or break its security. This includes reverse-engineering or probing the security of the app, the dashboard, the patch or our servers, and trying to see information you haven’t been given access to.',
            'Record or upload anyone else’s data. The patch linked to your account should only be worn by you.',
            'Let anyone else use your account, or pass on access that someone has shared with you.',
            'Interfere with how WearWise runs, for example by overloading our servers, collecting data with automated tools, or introducing harmful code.',
            'Open or modify the patch’s hardware, or install software on it other than what the study team provides.',
          ],
        },
        'If you find a security problem, please don’t test it further. Tell us at {{privacyEmail}} so we can fix it.',
      ],
    },
    {
      heading: 'Your data',
      blocks: [
        'We don’t claim to own your health readings or the other information you add to WearWise.',
        'You give us permission (a non-exclusive licence) to store, copy, process and display that information, but only so that we can:',
        {
          list: [
            'Run WearWise for you, for example to sync your recordings and show them in the app.',
            'Share it with the people you choose, in the way you choose.',
            'Carry out the research study, as described in our Privacy Policy and Research participation information. This includes publishing results, but only in a form that does not identify you.',
          ],
        },
        'This permission ends when your information is deleted. Results that have already been published in de-identified or combined form can’t be withdrawn.',
        'Our Privacy Policy explains what we collect, why, where it is stored, who can see it, and how to see, correct or delete it.',
      ],
    },
    {
      heading: 'Sharing is your choice',
      blocks: [
        'Nobody else sees your readings unless you decide to share them. To share, you create a one-time share code in the app and give it to a researcher or clinician. You choose which signals to include, and whether to include possible falls.',
        {
          list: [
            'You can see who has access at any time, in the app or on the web dashboard.',
            'You can stop sharing at any time, in the app or on the web dashboard. Their access ends immediately.',
            'You can switch on “Live view for setup” to stream your live readings to the people you share with, for 30 minutes or for a longer time you choose, up to 8 hours. It switches off automatically. Live readings are not stored. While it is on, the people watching can ask you to start a recording: nothing is recorded unless you tap Start, and the person who asked can stop that recording.',
          ],
        },
        'Researchers and clinicians you share with can download your shared recordings as a spreadsheet file (CSV). Stopping sharing doesn’t delete copies they have already downloaded. Our Researcher and clinician terms require them to keep those copies secure and delete them when they are no longer needed. Only share with people you trust.',
      ],
    },
    {
      heading: 'The patch and your safety',
      blocks: [
        'Before you wear the patch, read our Health and safety information and follow it. In particular:',
        {
          list: [
            'While the ECG electrodes are on your body, power the patch from its battery only. Never connect it to a mains-connected USB charger or a computer while you are wearing it.',
            'If your skin becomes irritated, stop using the patch and seek advice.',
            'If you have an implanted electronic medical device, such as a pacemaker, ask your doctor before you use the patch.',
          ],
        },
        'Follow any instructions the study team gives you about looking after the patch.',
      ],
    },
    {
      heading: 'Intellectual property',
      blocks: [
        'WearWise – including the app, the dashboard, the patch’s software (firmware), designs, text and logos – belongs to {{name}} or to the people who license it to us.',
        'We give you a personal, non-transferable permission to use WearWise for as long as these terms apply. You must not copy, change, share, sell or reverse-engineer WearWise, except where the law or an open-source licence allows it. Some parts of WearWise are open-source software, and each of those parts is covered by its own licence.',
      ],
    },
    {
      heading: 'Your rights under the Australian Consumer Law',
      blocks: [
        'The Australian Consumer Law may give you guarantees, rights and remedies that cannot be excluded. Nothing in these terms excludes, restricts or changes any guarantee, right or remedy you have under the Australian Consumer Law, or under any other law that cannot be excluded.',
        'If anything in these terms seems to say otherwise, the law wins.',
      ],
    },
    {
      heading: 'Limits on our liability',
      blocks: [
        'This section applies only to the extent the law allows, and it does not affect your rights under the Australian Consumer Law.',
        {
          list: [
            'WearWise is provided for research. We don’t promise that readings will be accurate or complete, or that alerts and fall detection will work every time.',
            'We are not responsible for decisions you make based on WearWise readings, alerts or fall detection, or for loss caused by WearWise being unavailable.',
            'We are not liable for indirect or consequential loss.',
          ],
        },
        'Nothing in these terms limits any liability that the law does not allow us to limit.',
      ],
    },
    {
      heading: 'Stopping, withdrawing and closing accounts',
      blocks: [
        'You can stop using WearWise and withdraw from the study at any time, without giving a reason and without any consequence for you. You can:',
        {
          list: [
            'Stop sharing, in the app or on the web dashboard. Access ends immediately.',
            'Stop wearing the patch and using the app.',
            'Delete recording sessions in the app. This deletes them from your phone and from the cloud.',
            'Ask us to delete your whole account by emailing {{privacyEmail}}. There is no button for this in the app yet.',
          ],
        },
        'We may suspend or close an account if:',
        {
          list: [
            'These terms have been broken.',
            'We need to, to protect participants’ information or the security of WearWise.',
            'The law requires it.',
            'We learn that the account holder is under 18.',
            'The study ends or WearWise is stopped.',
          ],
        },
        'Where it is reasonable to do so, we will tell you before we suspend or close your account, and explain why. What happens to your information afterwards is explained in our Privacy Policy.',
        'Parts of these terms that are meant to continue after an account closes – such as your consumer rights, the limits on liability and the governing law – keep applying.',
      ],
    },
    {
      heading: 'Changes to these terms',
      blocks: [
        'We may update these terms. Each version has a date, so you can tell which one you are reading. We record which version you have accepted.',
        'If we make an important change – for example, to what we collect, who can see your information or your rights – we will ask you to accept the new version in the app or on the dashboard before you continue. If you don’t accept it, you can stop using WearWise and withdraw as described above.',
        'Smaller changes, such as fixing typing errors or making wording clearer, apply from the date we publish them.',
      ],
    },
    {
      heading: 'Governing law',
      blocks: [
        'These terms are governed by the laws of {{governingLaw}}, Australia. Disputes about them can be decided by the courts of {{governingLaw}} and the courts that can hear appeals from them. This does not stop you from using any consumer or complaints process that is available to you.',
        'If any part of these terms can’t be enforced, the rest still applies.',
      ],
    },
    {
      heading: 'Contact us',
      blocks: [
        'WearWise is run by {{name}} (ABN {{abn}}).',
        {
          list: [
            'Questions about WearWise or these terms: {{supportEmail}}',
            'Privacy questions and deletion requests: {{privacyEmail}}',
            'Post: {{address}}',
            'Web dashboard: {{dashboardUrl}}',
          ],
        },
      ],
    },
  ],
};
