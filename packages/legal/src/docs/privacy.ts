import type { LegalDoc } from '../types';

export const privacy: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  summary:
    'How WearWise collects, uses, stores, shares and protects your personal information, including your health information, and how you can see, correct or delete it or make a complaint.',
  audience: 'everyone',
  version: '2026-10-17',
  sections: [
    {
      heading: 'In short',
      blocks: [
        {
          list: [
            'We collect readings from your patch so you can see them and so we can run the research study.',
            'Nobody else sees your readings unless you share them with a share code. You can stop sharing at any time, and access ends immediately.',
            'Your date of birth, height, weight, profile photo and Wi-Fi password stay on your phone. We never receive them.',
            'We don’t sell your information. We don’t show ads, and we don’t use analytics, tracking or crash-reporting tools.',
            'We only publish research results in a form that does not identify you.',
            'You can ask to see, correct or delete your information, and you can complain to us or to the Office of the Australian Information Commissioner (OAIC).',
          ],
        },
      ],
    },
    {
      heading: 'Who we are',
      blocks: [
        'WearWise is run by {{name}} (ABN {{abn}}). It is a research proof of concept made up of a wearable sensor patch, a phone app (iPhone and Android) and a web dashboard.',
        'This policy explains how we handle personal information about participants, who wear the patch and use the app, and about researchers and clinicians (“staff”), who use the dashboard to see what participants share with them.',
        'We handle personal information in line with the Privacy Act 1988 (Cth), including the Australian Privacy Principles (APPs), and any other privacy or health records laws that apply to us. Health information is “sensitive information” under the Privacy Act, and it gets extra protection.',
      ],
    },
    {
      heading: 'What we collect',
      blocks: [
        'Account details:',
        {
          list: [
            'Your name and email address.',
            'Your password. Our authentication service handles it and stores it only as a secure hash, so nobody can read your actual password.',
            'When you gave your consent, and that you confirmed you are 18 or older.',
            'Which version of our terms you accepted.',
          ],
        },
        'Health readings from your patch:',
        {
          list: [
            'ECG (the electrical trace of your heart rhythm).',
            'Heart rate.',
            'Blood oxygen (SpO₂).',
            'Skin temperature.',
            'Movement.',
            'Pulse wave (PPG).',
          ],
        },
        'Recording details: when each recording started and ended, how long it lasted, the patch’s name and identifier, its firmware version, whether it connected by Bluetooth or Wi-Fi, and whether the data was simulated rather than recorded.',
        'Possible falls: when a possible fall happened, how strong the impact was, and whether you said you were OK.',
        'Alerts: when a reading stayed outside its usual range – which reading it was, whether it was high or low, the most extreme value, and when the alert started and ended.',
        'If you are a researcher or clinician: your name and email address, and which participants have shared information with you.',
        'Technical information: when your phone or browser connects to our servers, our service providers handle the technical information needed to make that connection, such as your device’s IP address. They may keep it in security logs.',
      ],
    },
    {
      heading: 'What stays on your phone',
      blocks: [
        'Some information is kept only on your phone. It is never uploaded, and we never receive it:',
        {
          list: [
            'Your date of birth, height and weight, if you choose to add them. The app uses them to personalise the usual ranges for your readings.',
            'Your profile photo, if you add one.',
            'The Wi-Fi network password for your patch. It is kept in your phone’s secure storage and sent to the patch over encrypted Bluetooth. It never reaches our servers.',
            'Your app settings, such as whether notifications, sound and vibration are on.',
          ],
        },
        'Your readings are different: they are kept on your phone in an encrypted database, and also synced to our cloud database (see “Where your information is stored and overseas disclosure”).',
      ],
    },
    {
      heading: 'How we collect it',
      blocks: [
        {
          list: [
            'From you, when you sign up and when you use the app or the dashboard.',
            'From your patch, which sends readings to your phone over Bluetooth or Wi-Fi. The app then syncs them to our cloud database.',
            'From the app, which records the details of each recording, and any possible falls and alerts, while you use it.',
            'For staff accounts, from the WearWise administrator who creates your account.',
          ],
        },
      ],
    },
    {
      heading: 'Why we collect it',
      blocks: [
        'We collect and use your information to:',
        {
          list: [
            'Create your account and sign you in.',
            'Record, store, sync and show your readings, recordings, possible falls and alerts.',
            'Show alerts and the fall alarm on your phone.',
            'Share information with the researchers and clinicians you choose, and show you who has access.',
            'Send sign-up confirmation and password-reset emails.',
            'Keep WearWise secure and working, and fix problems.',
            'Record your consent and which version of our terms you accepted.',
            'Carry out the research study: testing whether the wearable patch and app work as a proof of concept, and publishing results that do not identify you.',
            'Meet our legal and ethics obligations.',
          ],
        },
        'We don’t use your information for advertising or marketing.',
      ],
    },
    {
      heading: 'Your consent to collecting health information',
      blocks: [
        'We only collect health information with your consent, and only because it is reasonably necessary for WearWise and the study.',
        'You give your consent when you create your account, and again when you accept an important change to our terms or this policy. We record when you gave it and which version you accepted.',
        'You can withdraw your consent at any time by stopping sharing, stopping using WearWise and asking us to delete your information (see “Keeping and deleting your information”). We can’t remove information that has already been included in published results that do not identify you.',
      ],
    },
    {
      heading: 'Who can see your information',
      blocks: [
        'You. You can see your readings and recordings in the app.',
        'The people you choose. Nobody else can see your readings unless you share them. To share, you create a one-time share code in the app and give it to a researcher or clinician. You choose which signals to include, and whether to include possible falls. They can then see:',
        {
          list: [
            'The display name on your account, if you set one. They don’t see your email address.',
            'The readings you chose to share, and the details of the recordings they come from.',
            'Alerts about those readings.',
            'Your possible falls, if you chose to include them.',
          ],
        },
        'You can see who has access, and stop sharing at any time, in the app or on the web dashboard. Their access ends immediately; a live view they already have open stops within a minute.',
        'Live view for setup. You can switch on live streaming of your readings to the people you share with, for 30 minutes or for a longer time you choose, up to 8 hours. It switches off automatically. Live readings are not stored. While it is on, the people watching can ask you to start a recording; it only starts if you agree on your phone, and is then stored and shared like any other recording.',
        'Downloads. Researchers and clinicians you share with can download your shared recordings as a spreadsheet file (CSV). Stopping sharing doesn’t delete copies they have already downloaded. Our Researcher and clinician terms require them to keep those copies confidential, store them only somewhere secure and approved, and delete them when they are no longer needed.',
        'Our service providers. We use these providers to run WearWise:',
        {
          list: [
            'Supabase, a cloud database service, for our database, sign-in (authentication), file storage and real-time messaging.',
            'Our email provider, to send sign-up confirmation and password-reset emails. It receives your email address.',
            'The web host that serves the web dashboard.',
            'The Apple App Store and Google Play, to distribute the app. When you download the app, they handle your information under their own privacy policies.',
          ],
        },
        'When the law requires it. We will disclose information if a law requires us to, for example under a court order.',
        'We don’t sell your information, and we don’t give it to anyone else – for example, advertisers, data brokers, insurers or employers.',
      ],
    },
    {
      heading: 'Research and publication',
      blocks: [
        'WearWise is part of a research study approved by {{ethicsCommittee}} (approval {{ethicsApproval}}). Our Research participation information explains the study.',
        'We use information collected through WearWise to find out whether the patch and app work as a proof of concept. We only publish or present results in de-identified or combined (aggregate) form. We never publish your name, your email address or anything else that identifies you.',
        'Researchers and clinicians who see information you share must follow our Researcher and clinician terms. These require them to keep it confidential, use it only for the approved study, and never try to re-identify anyone.',
      ],
    },
    {
      heading: 'Where your information is stored and overseas disclosure',
      blocks: [
        'Your readings are stored on your phone, in an encrypted database. When they sync, they are stored in our cloud database and file storage, provided by Supabase, in {{hostingRegion}}.',
        'Some of our service providers may process limited information outside Australia. For example, our email provider handles your email address to send sign-up and password-reset emails, and the dashboard’s web host handles the technical information needed to serve the dashboard to your browser.',
        'Before we disclose personal information to anyone overseas, we take reasonable steps, as APP 8 requires, to make sure they handle it in line with the Australian Privacy Principles.',
      ],
    },
    {
      heading: 'How we protect your information',
      blocks: [
        {
          list: [
            'On your phone, your readings are kept in an encrypted database, and your patch’s Wi-Fi password is kept in your phone’s secure storage.',
            'Your patch and phone connect using Bluetooth LE Secure Connections, which needs the 6-digit PIN printed on the patch’s label. When the patch streams over Wi-Fi, it uses TLS encryption.',
            'Information sent between the app, the dashboard and our servers is encrypted in transit (TLS).',
            'Access controls in our database mean only you, and the people you choose to share with, can read your health information.',
            'Your password is stored only as a secure hash.',
            'Researcher and clinician (staff) accounts can only be created by a WearWise administrator.',
            'We don’t include advertising, analytics, tracking or crash-reporting tools in the app or the dashboard.',
          ],
        },
        'No system is completely secure. You can help by keeping your password and your patch’s PIN private, using a screen lock on your phone, and only sharing with people you trust.',
      ],
    },
    {
      heading: 'If there is a data breach',
      blocks: [
        'If we suspect a data breach, we will act quickly to contain it and assess the risk.',
        'If a breach is likely to cause serious harm to anyone affected, we will notify the people affected and the OAIC, as the Notifiable Data Breaches scheme requires. We will tell you what happened and what you can do to protect yourself.',
      ],
    },
    {
      heading: 'Keeping and deleting your information',
      blocks: [
        'We keep your information for as long as your account is open and the study requires, as approved by {{ethicsCommittee}}. After that, it is deleted or de-identified.',
        'You can:',
        {
          list: [
            'Delete recording sessions in the app. This deletes them from your phone and from the cloud.',
            'Stop sharing at any time. Access ends immediately.',
            'Ask us to delete your whole account by emailing {{privacyEmail}}. There is no button for this in the app yet. We may need to confirm your identity first.',
          ],
        },
        'When we delete your account, we delete the information stored with it in the cloud, unless a law or the study’s ethics approval requires us to keep something. If that applies, we will tell you what we need to keep and why.',
        'Information kept only on your phone is never sent to us, so we can’t see or delete it for you.',
      ],
    },
    {
      heading: 'Seeing and correcting your information',
      blocks: [
        'You can see much of your information in the app, including your recordings and who you share with.',
        'You can also ask us for a copy of the personal information we hold about you (APP 12), or ask us to correct it if it is wrong, out of date or incomplete (APP 13). Email {{privacyEmail}} or write to us at {{address}}.',
        {
          list: [
            'There is no charge to make a request.',
            'We may need to confirm your identity before we act on it.',
            'We will respond within a reasonable time, and we aim to do so within 30 days.',
            'If we refuse your request, we will tell you why in writing and how you can complain.',
            'If we don’t agree that information needs correcting, you can ask us to attach a statement saying you believe it is wrong.',
          ],
        },
        'Health readings are measurements recorded by your patch, so we can’t edit them. If you don’t want a recording kept, you can delete it in the app.',
      ],
    },
    {
      heading: 'Using WearWise without identifying yourself',
      blocks: [
        'Where it is lawful and practicable, you have the right to deal with us anonymously or under a pseudonym (APP 2).',
        'For WearWise, this isn’t practicable. We need an account with a working email address to link your readings to you, keep them private, let you control who sees them and let you reset your password. The study also needs to record who has consented.',
        'You can still contact us with a general question without giving your name.',
      ],
    },
    {
      heading: 'People under 18',
      blocks: [
        'WearWise is only for people aged 18 or older, and everyone must confirm this when they sign up.',
        'If we learn that someone under 18 has created an account, we will close it, and we will delete its data on request. A parent or guardian can contact us at {{privacyEmail}}.',
      ],
    },
    {
      heading: 'Cookies and local storage',
      blocks: [
        'The web dashboard doesn’t use cookies.',
        'It uses your browser’s local storage only to keep you signed in and to remember small preferences, such as which alerts you’ve seen and whether alert sounds are on. This stays in your browser. Clearing your browser’s site data removes it and signs you out.',
        'The phone app keeps your settings on your phone.',
      ],
    },
    {
      heading: 'Notifications',
      blocks: [
        'The app shows notifications on your phone when a reading goes outside its usual range, when there may have been a fall, and when the patch disconnects during a recording.',
        'These notifications are created on your phone itself. We don’t use a push notification service, and nothing about them is sent to a third party.',
        'The web dashboard can show browser notifications while it is open, if you allow them in your browser.',
      ],
    },
    {
      heading: 'Complaints',
      blocks: [
        'If you have a concern about how we have handled your personal information, please contact us first at {{privacyEmail}} or {{address}}. Tell us what happened and how you would like it resolved. We will respond within a reasonable time, and we aim to do so within 30 days.',
        'If you are not satisfied with our response, you can complain to the Office of the Australian Information Commissioner (OAIC):',
        {
          list: ['Website: oaic.gov.au', 'Phone: 1300 363 992'],
        },
        'If your concern is about how the research study is being run, you can also contact {{ethicsCommittee}}, quoting approval {{ethicsApproval}}.',
      ],
    },
    {
      heading: 'Changes to this policy',
      blocks: [
        'We may update this policy. Each version has a date, so you can tell which one you are reading.',
        'If we make an important change – for example, to what we collect, why, or who can see it – we will ask you to accept the new version in the app or on the dashboard before you continue.',
      ],
    },
    {
      heading: 'Contact us',
      blocks: [
        {
          list: [
            'Organisation: {{name}} (ABN {{abn}})',
            'Privacy questions, requests and complaints: {{privacyEmail}}',
            'Post: {{address}}',
            'General support: {{supportEmail}}',
          ],
        },
      ],
    },
  ],
};
