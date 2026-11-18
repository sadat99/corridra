// Words of the top bar (UI/UX.v4 screen 10): Listen, its spoken names and the drawer's Help row. English is the source.
// The bn, zh, es, ar, fr and de words are drafts written by an AI builder. They are NOT native-reviewed and are shown
// only for a language the owner lists in CORRIDRA_LANGUAGES_REVIEWED (see locales.ts). Each visible word is contained in
// its spoken name, so the accessible name starts from what a person sees. No dash is used as punctuation.

export const topBarEn = {
  'header.listen': 'Listen',
  'header.listenStop': 'Stop',
  'header.listenLabel': 'Listen to This Page',
  'header.listenStopLabel': 'Stop Reading',
  'header.help': 'Help',
} as const;

export const topBarDrafts = {
  bn: {
    'header.listen': 'শুনুন',
    'header.listenStop': 'থামান',
    'header.listenLabel': 'এই পাতা শুনুন',
    'header.listenStopLabel': 'পড়া থামান',
    'header.help': 'সাহায্য',
  },
  zh: {
    'header.listen': '朗读',
    'header.listenStop': '停止',
    'header.listenLabel': '朗读本页',
    'header.listenStopLabel': '停止朗读',
    'header.help': '帮助',
  },
  es: {
    'header.listen': 'Escuchar',
    'header.listenStop': 'Detener',
    'header.listenLabel': 'Escuchar esta página',
    'header.listenStopLabel': 'Detener la lectura',
    'header.help': 'Ayuda',
  },
  ar: {
    'header.listen': 'استمع',
    'header.listenStop': 'إيقاف',
    'header.listenLabel': 'استمع إلى هذه الصفحة',
    'header.listenStopLabel': 'إيقاف القراءة',
    'header.help': 'مساعدة',
  },
  fr: {
    'header.listen': 'Écouter',
    'header.listenStop': 'Arrêter',
    'header.listenLabel': 'Écouter cette page',
    'header.listenStopLabel': 'Arrêter la lecture',
    'header.help': 'Aide',
  },
  de: {
    'header.listen': 'Anhören',
    'header.listenStop': 'Beenden',
    'header.listenLabel': 'Diese Seite anhören',
    'header.listenStopLabel': 'Vorlesen beenden',
    'header.help': 'Hilfe',
  },
} as const;
