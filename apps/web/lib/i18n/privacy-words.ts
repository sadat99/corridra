/**
 * "Who can see it" words (PL1). English is the source. The bn, zh, es, ar, fr and de entries are drafts: native
 * review is pending (docs/product/language-review-record.md), and a draft language is offered to the public only once
 * a reviewer is recorded (locales.ts), so the label follows the page's own language and is never shown in a language
 * the page itself does not show.
 */
export const privacyEn = {
  'privacy.heading': 'Who can see it',
  'privacy.canSee': 'Can see it',
  'privacy.notStated': 'Not stated',
  'privacy.reader.anyoneWithLink': 'Anyone with the link until it expires or is withdrawn',
  'privacy.reader.youMadeLink': 'You, who made the link',
  'privacy.reader.youSaved': 'You, who saved this report',
  'privacy.reader.anyoneWithReportLink':
    'Anyone with the original report link until it expires or is withdrawn',
  'privacy.reader.workspace': 'Other people in your workspace',
  'privacy.reader.corridra': 'The Corridra team',
  'privacy.reader.anyoneWithReplyLink': 'Anyone with this link until it expires',
  'privacy.reader.sendingTeam': 'The team that sent you this request',
  'privacy.reader.requester': 'The customer who asked for this introduction',
} as const;

type PrivacyWords = Record<keyof typeof privacyEn, string>;

/** Drafts, native review pending. */
export const privacyDrafts: Record<'bn' | 'zh' | 'es' | 'ar' | 'fr' | 'de', PrivacyWords> = {
  bn: {
    'privacy.heading': 'কে এটি দেখতে পারে',
    'privacy.canSee': 'দেখতে পারে',
    'privacy.notStated': 'উল্লেখ নেই',
    'privacy.reader.anyoneWithLink':
      'লিংকটি যার কাছে আছে, মেয়াদ শেষ বা প্রত্যাহার না হওয়া পর্যন্ত',
    'privacy.reader.youMadeLink': 'আপনি, যিনি লিংকটি তৈরি করেছেন',
    'privacy.reader.youSaved': 'আপনি, যিনি এই রিপোর্টটি সংরক্ষণ করেছেন',
    'privacy.reader.anyoneWithReportLink':
      'মূল রিপোর্টের লিংকটি যার কাছে আছে, মেয়াদ শেষ বা প্রত্যাহার না হওয়া পর্যন্ত',
    'privacy.reader.workspace': 'আপনার ওয়ার্কস্পেসের অন্য সদস্যরা',
    'privacy.reader.corridra': 'Corridra টিম',
    'privacy.reader.anyoneWithReplyLink': 'এই লিংকটি যার কাছে আছে, মেয়াদ শেষ না হওয়া পর্যন্ত',
    'privacy.reader.sendingTeam': 'যে টিম আপনাকে এই অনুরোধ পাঠিয়েছে',
    'privacy.reader.requester': 'যে গ্রাহক এই পরিচয়ের অনুরোধ করেছেন',
  },
  zh: {
    'privacy.heading': '谁可以看到',
    'privacy.canSee': '可以看到',
    'privacy.notStated': '未说明',
    'privacy.reader.anyoneWithLink': '持有此链接的任何人，直到链接过期或被撤回',
    'privacy.reader.youMadeLink': '您（链接的创建者）',
    'privacy.reader.youSaved': '您（保存此报告的人）',
    'privacy.reader.anyoneWithReportLink': '持有原始报告链接的任何人，直到链接过期或被撤回',
    'privacy.reader.workspace': '您工作区中的其他人',
    'privacy.reader.corridra': 'Corridra 团队',
    'privacy.reader.anyoneWithReplyLink': '持有此链接的任何人，直到链接过期',
    'privacy.reader.sendingTeam': '向您发送此请求的团队',
    'privacy.reader.requester': '请求此次介绍的客户',
  },
  es: {
    'privacy.heading': 'Quién puede verlo',
    'privacy.canSee': 'Puede verlo',
    'privacy.notStated': 'No indicado',
    'privacy.reader.anyoneWithLink':
      'Cualquier persona con el enlace, hasta que caduque o se retire',
    'privacy.reader.youMadeLink': 'Usted, que creó el enlace',
    'privacy.reader.youSaved': 'Usted, que guardó este informe',
    'privacy.reader.anyoneWithReportLink':
      'Cualquier persona con el enlace original del informe, hasta que caduque o se retire',
    'privacy.reader.workspace': 'Otras personas de su espacio de trabajo',
    'privacy.reader.corridra': 'El equipo de Corridra',
    'privacy.reader.anyoneWithReplyLink': 'Cualquier persona con este enlace, hasta que caduque',
    'privacy.reader.sendingTeam': 'El equipo que le envió esta solicitud',
    'privacy.reader.requester': 'El cliente que pidió esta presentación',
  },
  ar: {
    'privacy.heading': 'من يمكنه رؤيته',
    'privacy.canSee': 'يمكنه رؤيته',
    'privacy.notStated': 'غير مذكور',
    'privacy.reader.anyoneWithLink': 'أي شخص لديه الرابط، حتى تنتهي صلاحيته أو يُسحب',
    'privacy.reader.youMadeLink': 'أنت، منشئ الرابط',
    'privacy.reader.youSaved': 'أنت، من حفظ هذا التقرير',
    'privacy.reader.anyoneWithReportLink':
      'أي شخص لديه رابط التقرير الأصلي، حتى تنتهي صلاحيته أو يُسحب',
    'privacy.reader.workspace': 'أشخاص آخرون في مساحة عملك',
    'privacy.reader.corridra': 'فريق Corridra',
    'privacy.reader.anyoneWithReplyLink': 'أي شخص لديه هذا الرابط، حتى تنتهي صلاحيته',
    'privacy.reader.sendingTeam': 'الفريق الذي أرسل إليك هذا الطلب',
    'privacy.reader.requester': 'العميل الذي طلب هذا التعريف',
  },
  fr: {
    'privacy.heading': 'Qui peut le voir',
    'privacy.canSee': 'Peut le voir',
    'privacy.notStated': 'Non précisé',
    'privacy.reader.anyoneWithLink':
      "Toute personne disposant du lien, jusqu'à son expiration ou son retrait",
    'privacy.reader.youMadeLink': 'Vous, qui avez créé le lien',
    'privacy.reader.youSaved': 'Vous, qui avez enregistré ce rapport',
    'privacy.reader.anyoneWithReportLink':
      "Toute personne disposant du lien d'origine du rapport, jusqu'à son expiration ou son retrait",
    'privacy.reader.workspace': 'Les autres membres de votre espace de travail',
    'privacy.reader.corridra': "L'équipe Corridra",
    'privacy.reader.anyoneWithReplyLink':
      "Toute personne disposant de ce lien, jusqu'à son expiration",
    'privacy.reader.sendingTeam': "L'équipe qui vous a envoyé cette demande",
    'privacy.reader.requester': 'Le client qui a demandé cette mise en relation',
  },
  de: {
    'privacy.heading': 'Wer es sehen kann',
    'privacy.canSee': 'Kann es sehen',
    'privacy.notStated': 'Nicht angegeben',
    'privacy.reader.anyoneWithLink': 'Alle mit dem Link, bis er abläuft oder zurückgezogen wird',
    'privacy.reader.youMadeLink': 'Sie, die den Link erstellt haben',
    'privacy.reader.youSaved': 'Sie, die diesen Bericht gespeichert haben',
    'privacy.reader.anyoneWithReportLink':
      'Alle mit dem ursprünglichen Berichtslink, bis er abläuft oder zurückgezogen wird',
    'privacy.reader.workspace': 'Andere Personen in Ihrem Arbeitsbereich',
    'privacy.reader.corridra': 'Das Corridra-Team',
    'privacy.reader.anyoneWithReplyLink': 'Alle mit diesem Link, bis er abläuft',
    'privacy.reader.sendingTeam': 'Das Team, das Ihnen diese Anfrage gesendet hat',
    'privacy.reader.requester': 'Der Kunde, der um diese Vorstellung gebeten hat',
  },
};
