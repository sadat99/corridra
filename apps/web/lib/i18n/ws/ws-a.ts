import type { Locale } from '../locales';

// WS-A message block (commercial readiness program, D16 and 3.3). Only WS-A edits this file.
// Keys start with "wsa.". English is the source; every other language needs the same keys. The
// translations are drafts until a native reviewer is recorded in docs/qa/2026-10-31/i18n-review.md.
// Privacy and consent lines stay in English.
export const wsAEn = {
  'wsa.plan.required': 'Required',
  'wsa.plan.outcomesHint': 'Choose at least one.',
  'wsa.plan.trip.offer': 'What should the trip achieve?',
  'wsa.plan.trip.offerExample':
    'Example: Twelve garment exporters visit buyers in Guangzhou for four days in March. Each wants two meetings with buyers who fit.',
  'wsa.plan.trip.offerHint':
    'Say who is travelling, where and when, and what each participant hopes to bring home. Details can follow later.',
  'wsa.plan.jobChoice':
    'You have a saved request. Continue it, or start a new request for “{job}”?',
  'wsa.plan.jobChoice.continue': 'Continue saved request',
  'wsa.plan.jobChoice.start': 'Start a new request',
  'wsa.plan.countries.pinned': 'Most requested',
  'wsa.plan.countries.eu': 'EU countries',
  'wsa.plan.countries.other': 'Other countries',
  'wsa.plan.check.hintReal': 'The code from your request receipt email.',
  'wsa.plan.check.hintSample': 'The code shown after you sent the request.',
  'wsa.plan.check.empty': 'Enter the code from your receipt.',
} as const;

export const wsA: Record<Exclude<Locale, 'en'>, Record<keyof typeof wsAEn, string>> = {
  bn: {
    'wsa.plan.required': 'আবশ্যক',
    'wsa.plan.outcomesHint': 'অন্তত একটি বেছে নিন।',
    'wsa.plan.trip.offer': 'এই সফর থেকে কী অর্জন করতে চান?',
    'wsa.plan.trip.offerExample':
      'উদাহরণ: বারোজন পোশাক রপ্তানিকারক মার্চে চার দিনের জন্য গুয়াংজুতে ক্রেতাদের সঙ্গে দেখা করবেন। প্রত্যেকে উপযুক্ত ক্রেতার সঙ্গে দুটি বৈঠক চান।',
    'wsa.plan.trip.offerHint':
      'কে যাচ্ছেন, কোথায় ও কখন, এবং প্রত্যেক অংশগ্রহণকারী কী নিয়ে ফিরতে চান তা লিখুন। বিস্তারিত পরে দেওয়া যাবে।',
    'wsa.plan.jobChoice':
      'আপনার একটি সংরক্ষিত অনুরোধ আছে। সেটি চালিয়ে যাবেন, নাকি “{job}” এর জন্য নতুন অনুরোধ শুরু করবেন?',
    'wsa.plan.jobChoice.continue': 'সংরক্ষিত অনুরোধ চালিয়ে যান',
    'wsa.plan.jobChoice.start': 'নতুন অনুরোধ শুরু করুন',
    'wsa.plan.countries.pinned': 'সবচেয়ে বেশি অনুরোধ করা',
    'wsa.plan.countries.eu': 'ইইউ দেশ',
    'wsa.plan.countries.other': 'অন্যান্য দেশ',
    'wsa.plan.check.hintReal': 'আপনার অনুরোধের রসিদ ইমেইলের কোড।',
    'wsa.plan.check.hintSample': 'অনুরোধ পাঠানোর পরে দেখানো কোড।',
    'wsa.plan.check.empty': 'আপনার রসিদের কোড লিখুন।',
  },
  zh: {
    'wsa.plan.required': '必填',
    'wsa.plan.outcomesHint': '请至少选择一项。',
    'wsa.plan.trip.offer': '这次出行要达成什么？',
    'wsa.plan.trip.offerExample':
      '示例：十二家服装出口商三月赴广州拜访买家四天，每家希望与合适的买家会面两次。',
    'wsa.plan.trip.offerHint':
      '说明谁出行、去哪里、何时去，以及每位参与者希望带回什么。细节可以稍后补充。',
    'wsa.plan.jobChoice': '您有一个已保存的请求。继续该请求，还是为“{job}”开始新的请求？',
    'wsa.plan.jobChoice.continue': '继续已保存的请求',
    'wsa.plan.jobChoice.start': '开始新的请求',
    'wsa.plan.countries.pinned': '最常选择',
    'wsa.plan.countries.eu': '欧盟国家',
    'wsa.plan.countries.other': '其他国家',
    'wsa.plan.check.hintReal': '您的请求回执邮件中的代码。',
    'wsa.plan.check.hintSample': '发送请求后显示的代码。',
    'wsa.plan.check.empty': '请输入回执上的代码。',
  },
  es: {
    'wsa.plan.required': 'Obligatorio',
    'wsa.plan.outcomesHint': 'Elija al menos una opción.',
    'wsa.plan.trip.offer': '¿Qué debe lograr el viaje?',
    'wsa.plan.trip.offerExample':
      'Ejemplo: Doce exportadores de prendas visitan compradores en Cantón durante cuatro días en marzo. Cada uno quiere dos reuniones con compradores adecuados.',
    'wsa.plan.trip.offerHint':
      'Indique quién viaja, adónde y cuándo, y qué espera conseguir cada participante. Los detalles pueden llegar después.',
    'wsa.plan.jobChoice':
      'Tiene una solicitud guardada. ¿Desea continuarla o empezar una nueva solicitud para «{job}»?',
    'wsa.plan.jobChoice.continue': 'Continuar la solicitud',
    'wsa.plan.jobChoice.start': 'Empezar una nueva',
    'wsa.plan.countries.pinned': 'Los más solicitados',
    'wsa.plan.countries.eu': 'Países de la UE',
    'wsa.plan.countries.other': 'Otros países',
    'wsa.plan.check.hintReal': 'El código del correo de recibo de su solicitud.',
    'wsa.plan.check.hintSample': 'El código que se mostró al enviar la solicitud.',
    'wsa.plan.check.empty': 'Introduzca el código de su recibo.',
  },
  ar: {
    'wsa.plan.required': 'مطلوب',
    'wsa.plan.outcomesHint': 'اختر خيارًا واحدًا على الأقل.',
    'wsa.plan.trip.offer': 'ما الذي يجب أن تحققه الرحلة؟',
    'wsa.plan.trip.offerExample':
      'مثال: اثنا عشر مصدّرًا للملابس يزورون مشترين في قوانغتشو لمدة أربعة أيام في مارس. يريد كل منهم لقاءين مع مشترين مناسبين.',
    'wsa.plan.trip.offerHint':
      'اذكر من يسافر وإلى أين ومتى، وما يأمل كل مشارك في تحقيقه. يمكن إضافة التفاصيل لاحقًا.',
    'wsa.plan.jobChoice': 'لديك طلب محفوظ. هل تريد متابعته أم بدء طلب جديد لـ «{job}»؟',
    'wsa.plan.jobChoice.continue': 'متابعة الطلب المحفوظ',
    'wsa.plan.jobChoice.start': 'بدء طلب جديد',
    'wsa.plan.countries.pinned': 'الأكثر طلبًا',
    'wsa.plan.countries.eu': 'دول الاتحاد الأوروبي',
    'wsa.plan.countries.other': 'دول أخرى',
    'wsa.plan.check.hintReal': 'الرمز الموجود في رسالة إيصال طلبك.',
    'wsa.plan.check.hintSample': 'الرمز الذي ظهر بعد إرسال الطلب.',
    'wsa.plan.check.empty': 'أدخل الرمز الموجود في الإيصال.',
  },
  fr: {
    'wsa.plan.required': 'Obligatoire',
    'wsa.plan.outcomesHint': 'Choisissez au moins une option.',
    'wsa.plan.trip.offer': 'Que doit permettre le voyage ?',
    'wsa.plan.trip.offerExample':
      'Exemple : douze exportateurs de vêtements rencontrent des acheteurs à Canton pendant quatre jours en mars. Chacun souhaite deux rendez-vous avec des acheteurs adaptés.',
    'wsa.plan.trip.offerHint':
      'Indiquez qui voyage, où et quand, et ce que chaque participant espère rapporter. Les détails peuvent suivre.',
    'wsa.plan.jobChoice':
      'Vous avez une demande enregistrée. Voulez-vous la poursuivre ou commencer une nouvelle demande pour « {job} » ?',
    'wsa.plan.jobChoice.continue': 'Poursuivre la demande',
    'wsa.plan.jobChoice.start': 'Nouvelle demande',
    'wsa.plan.countries.pinned': 'Les plus demandés',
    'wsa.plan.countries.eu': 'Pays de l’UE',
    'wsa.plan.countries.other': 'Autres pays',
    'wsa.plan.check.hintReal': 'Le code figurant dans l’e-mail de reçu de votre demande.',
    'wsa.plan.check.hintSample': 'Le code affiché après l’envoi de la demande.',
    'wsa.plan.check.empty': 'Saisissez le code de votre reçu.',
  },
  de: {
    'wsa.plan.required': 'Pflichtangabe',
    'wsa.plan.outcomesHint': 'Wählen Sie mindestens eine Option.',
    'wsa.plan.trip.offer': 'Was soll die Reise erreichen?',
    'wsa.plan.trip.offerExample':
      'Beispiel: Zwölf Bekleidungsexporteure besuchen im März vier Tage lang Einkäufer in Guangzhou. Jeder möchte zwei Treffen mit passenden Einkäufern.',
    'wsa.plan.trip.offerHint':
      'Nennen Sie, wer reist, wohin und wann, und was jeder Teilnehmer mitnehmen möchte. Details können später folgen.',
    'wsa.plan.jobChoice':
      'Sie haben eine gespeicherte Anfrage. Möchten Sie sie fortsetzen oder eine neue Anfrage für „{job}“ beginnen?',
    'wsa.plan.jobChoice.continue': 'Gespeicherte fortsetzen',
    'wsa.plan.jobChoice.start': 'Neue Anfrage beginnen',
    'wsa.plan.countries.pinned': 'Am häufigsten gewählt',
    'wsa.plan.countries.eu': 'EU-Länder',
    'wsa.plan.countries.other': 'Weitere Länder',
    'wsa.plan.check.hintReal': 'Der Code aus der Eingangsbestätigung Ihrer Anfrage per E-Mail.',
    'wsa.plan.check.hintSample': 'Der Code, der nach dem Senden der Anfrage angezeigt wurde.',
    'wsa.plan.check.empty': 'Geben Sie den Code aus Ihrer Bestätigung ein.',
  },
};
