import type { Locale } from '../locales';

// WS-B message block (commercial readiness program, D16 and 3.3). Only WS-B edits this file.
// Keys start with "wsb.". English is the source; every other language needs the same keys. The
// translations are drafts until a native reviewer is recorded in docs/qa/2026-10-31/i18n-review.md.
// Privacy and consent lines stay in English.
export const wsBEn = {
  // D6: a request the customer sent is never called a draft.
  'wsb.status.received': 'Received, waiting for review.',
  'wsb.status.draft': 'Draft',
  // CQ-21: an unsent draft asks to be finished and sent.
  'wsb.move.draft.action': 'Finish and send',
  // CQ-77: a published report the customer can read.
  'wsb.move.report.object': 'your new report',
  'wsb.move.report.action': 'Open the report',
  'wsb.move.report.title': 'New report ready',
} as const;

export const wsB: Record<Exclude<Locale, 'en'>, Record<keyof typeof wsBEn, string>> = {
  bn: {
    'wsb.status.received': 'পাওয়া গেছে, পর্যালোচনার অপেক্ষায়।',
    'wsb.status.draft': 'খসড়া',
    'wsb.move.draft.action': 'শেষ করে পাঠান',
    'wsb.move.report.object': 'আপনার নতুন রিপোর্ট',
    'wsb.move.report.action': 'রিপোর্ট খুলুন',
    'wsb.move.report.title': 'নতুন রিপোর্ট প্রস্তুত',
  },
  zh: {
    'wsb.status.received': '已收到，等待审核。',
    'wsb.status.draft': '草稿',
    'wsb.move.draft.action': '完成并发送',
    'wsb.move.report.object': '您的新报告',
    'wsb.move.report.action': '打开报告',
    'wsb.move.report.title': '新报告已就绪',
  },
  es: {
    'wsb.status.received': 'Recibida, pendiente de revisión.',
    'wsb.status.draft': 'Borrador',
    'wsb.move.draft.action': 'Terminar y enviar',
    'wsb.move.report.object': 'tu nuevo informe',
    'wsb.move.report.action': 'Abrir el informe',
    'wsb.move.report.title': 'Nuevo informe disponible',
  },
  ar: {
    'wsb.status.received': 'تم الاستلام، بانتظار المراجعة.',
    'wsb.status.draft': 'مسودة',
    'wsb.move.draft.action': 'أكمل وأرسل',
    'wsb.move.report.object': 'تقريرك الجديد',
    'wsb.move.report.action': 'افتح التقرير',
    'wsb.move.report.title': 'تقرير جديد جاهز',
  },
  fr: {
    'wsb.status.received': 'Reçue, en attente d’examen.',
    'wsb.status.draft': 'Brouillon',
    'wsb.move.draft.action': 'Terminer et envoyer',
    'wsb.move.report.object': 'votre nouveau rapport',
    'wsb.move.report.action': 'Ouvrir le rapport',
    'wsb.move.report.title': 'Nouveau rapport disponible',
  },
  de: {
    'wsb.status.received': 'Eingegangen, wartet auf Prüfung.',
    'wsb.status.draft': 'Entwurf',
    'wsb.move.draft.action': 'Fertigstellen und senden',
    'wsb.move.report.object': 'Ihren neuen Bericht',
    'wsb.move.report.action': 'Bericht öffnen',
    'wsb.move.report.title': 'Neuer Bericht verfügbar',
  },
};
