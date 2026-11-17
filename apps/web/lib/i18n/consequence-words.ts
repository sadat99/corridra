/**
 * "What happens when you send this" words (visual grammar PR 5, V3-05-033). English is the source. The bn, zh, es, ar,
 * fr and de entries are drafts: native review is pending (docs/product/language-review-record.md), and a draft
 * language is offered to the public only once a reviewer is recorded (locales.ts). Every line states only what the
 * database enforces for an evidence response (apps/web/lib/consequence-preview.ts names the migration lines).
 */
export const consequenceEn = {
  'consequence.heading': 'What happens when you send this',
  'consequence.what': 'What is sent',
  'consequence.whatBody': 'The text you typed above, recorded as your own declaration.',
  'consequence.once': 'How many times',
  'consequence.onceBody':
    'One response is kept for this request. A different one cannot be sent afterwards.',
  'consequence.until': 'Until when',
  'consequence.untilBody':
    'It stays readable through this link at most until the link expires or is withdrawn. This link expires on',
} as const;

type ConsequenceWords = Record<keyof typeof consequenceEn, string>;

/** Drafts, native review pending. */
export const consequenceDrafts: Record<'bn' | 'zh' | 'es' | 'ar' | 'fr' | 'de', ConsequenceWords> =
  {
    bn: {
      'consequence.heading': 'এটি পাঠালে কী হবে',
      'consequence.what': 'কী পাঠানো হয়',
      'consequence.whatBody': 'আপনি উপরে যা লিখেছেন, আপনার নিজের ঘোষণা হিসেবে সংরক্ষিত হবে।',
      'consequence.once': 'কতবার',
      'consequence.onceBody':
        'এই অনুরোধের জন্য একটি উত্তরই রাখা হয়। পরে অন্য একটি উত্তর পাঠানো যায় না।',
      'consequence.until': 'কতদিন পর্যন্ত',
      'consequence.untilBody':
        'লিংকটির মেয়াদ শেষ বা প্রত্যাহার না হওয়া পর্যন্ত, বড়জোর, এই লিংকের মাধ্যমে এটি পড়া যাবে। এই লিংকের মেয়াদ শেষ হবে',
    },
    zh: {
      'consequence.heading': '发送后会怎样',
      'consequence.what': '发送的内容',
      'consequence.whatBody': '您在上方输入的文字，将记录为您本人的声明。',
      'consequence.once': '可发送几次',
      'consequence.onceBody': '此请求只保留一份回复，之后无法再发送不同的回复。',
      'consequence.until': '保留到何时',
      'consequence.untilBody': '最长在此链接过期或被撤回之前，可通过此链接查看。此链接的过期时间为',
    },
    es: {
      'consequence.heading': 'Qué ocurre al enviar esto',
      'consequence.what': 'Qué se envía',
      'consequence.whatBody':
        'El texto que escribió arriba, registrado como su propia declaración.',
      'consequence.once': 'Cuántas veces',
      'consequence.onceBody':
        'Se conserva una sola respuesta para esta solicitud. Después no se puede enviar otra distinta.',
      'consequence.until': 'Hasta cuándo',
      'consequence.untilBody':
        'Se puede leer con este enlace, como máximo, hasta que el enlace caduque o se retire. Este enlace caduca el',
    },
    ar: {
      'consequence.heading': 'ماذا يحدث عند الإرسال',
      'consequence.what': 'ما الذي يُرسل',
      'consequence.whatBody': 'النص الذي كتبتَه أعلاه، ويُسجَّل بوصفه إقرارًا منك.',
      'consequence.once': 'كم مرة',
      'consequence.onceBody': 'يُحتفظ بردّ واحد لهذا الطلب. لا يمكن إرسال ردّ مختلف بعد ذلك.',
      'consequence.until': 'حتى متى',
      'consequence.untilBody':
        'يمكن قراءته عبر هذا الرابط، على الأكثر، حتى تنتهي صلاحية الرابط أو يُسحب. تنتهي صلاحية هذا الرابط في',
    },
    fr: {
      'consequence.heading': 'Ce qui se passe quand vous envoyez ceci',
      'consequence.what': 'Ce qui est envoyé',
      'consequence.whatBody':
        'Le texte saisi ci-dessus, enregistré comme votre propre déclaration.',
      'consequence.once': 'Combien de fois',
      'consequence.onceBody':
        'Une seule réponse est conservée pour cette demande. Une autre ne pourra plus être envoyée ensuite.',
      'consequence.until': "Jusqu'à quand",
      'consequence.untilBody':
        "Elle peut être lue avec ce lien, au plus, jusqu'à ce que le lien expire ou soit retiré. Ce lien expire le",
    },
    de: {
      'consequence.heading': 'Was passiert, wenn Sie dies senden',
      'consequence.what': 'Was gesendet wird',
      'consequence.whatBody': 'Der oben eingegebene Text, erfasst als Ihre eigene Erklärung.',
      'consequence.once': 'Wie oft',
      'consequence.onceBody':
        'Für diese Anfrage wird eine Antwort gespeichert. Danach kann keine andere mehr gesendet werden.',
      'consequence.until': 'Bis wann',
      'consequence.untilBody':
        'Sie kann über diesen Link höchstens so lange gelesen werden, bis der Link abläuft oder zurückgezogen wird. Dieser Link läuft ab am',
    },
  };
