/**
 * "What happens when you send this" words (visual grammar PR 5, V3-05-033). English is the source. The bn, zh, es, ar,
 * fr and de entries are drafts: native review is pending (docs/product/language-review-record.md), and a draft
 * language is offered to the public only once a reviewer is recorded (locales.ts). Every line states only what the
 * database enforces for an evidence response (apps/web/lib/consequence-preview.ts names the migration lines).
 */
export const consequenceEn = {
  'consequence.heading': 'What happens when you press Send response',
  'consequence.what': 'What is sent',
  'consequence.whatBody':
    'The text you typed in the response box, recorded as your own declaration. One response is kept for each request, and a different one cannot be sent afterwards.',
  'consequence.until': 'Until when',
  'consequence.untilBody': 'At most until the link expires or is withdrawn. This link expires on',
  'privacy.reader.anyoneWithThisLink': 'Anyone with this link',
} as const;

type ConsequenceWords = Record<keyof typeof consequenceEn, string>;

/** Drafts, native review pending. */
export const consequenceDrafts: Record<'bn' | 'zh' | 'es' | 'ar' | 'fr' | 'de', ConsequenceWords> =
  {
    bn: {
      'consequence.heading': 'উত্তর পাঠান চাপলে কী হবে',
      'consequence.what': 'কী পাঠানো হয়',
      'consequence.whatBody':
        'উত্তরের বাক্সে আপনি যা লিখেছেন, আপনার নিজের ঘোষণা হিসেবে সংরক্ষিত হবে। প্রতিটি অনুরোধের জন্য একটি উত্তরই রাখা হয়, পরে অন্য উত্তর পাঠানো যায় না।',
      'consequence.until': 'কতদিন পর্যন্ত',
      'consequence.untilBody':
        'বড়জোর লিংকটির মেয়াদ শেষ বা প্রত্যাহার না হওয়া পর্যন্ত। এই লিংকের মেয়াদ শেষ হবে',
      'privacy.reader.anyoneWithThisLink': 'এই লিংকটি যার কাছে আছে',
    },
    zh: {
      'consequence.heading': '点击“发送回复”后会怎样',
      'consequence.what': '发送的内容',
      'consequence.whatBody':
        '您在回复框中输入的文字，将记录为您本人的声明。每个请求只保留一份回复，之后无法再发送不同的回复。',
      'consequence.until': '保留到何时',
      'consequence.untilBody': '最长保留到链接过期或被撤回。此链接的过期时间为',
      'privacy.reader.anyoneWithThisLink': '持有此链接的任何人',
    },
    es: {
      'consequence.heading': 'Qué ocurre al pulsar Enviar respuesta',
      'consequence.what': 'Qué se envía',
      'consequence.whatBody':
        'El texto que escribió en el cuadro de respuesta, registrado como su propia declaración. Se conserva una sola respuesta por solicitud y después no se puede enviar otra distinta.',
      'consequence.until': 'Hasta cuándo',
      'consequence.untilBody':
        'Como máximo hasta que el enlace caduque o se retire. Este enlace caduca el',
      'privacy.reader.anyoneWithThisLink': 'Cualquier persona con este enlace',
    },
    ar: {
      'consequence.heading': 'ماذا يحدث عند الضغط على إرسال الرد',
      'consequence.what': 'ما الذي يُرسل',
      'consequence.whatBody':
        'النص الذي كتبتَه في خانة الرد، ويُسجَّل بوصفه إقرارًا منك. يُحتفظ بردّ واحد لكل طلب، ولا يمكن إرسال ردّ مختلف بعد ذلك.',
      'consequence.until': 'حتى متى',
      'consequence.untilBody':
        'على الأكثر حتى تنتهي صلاحية الرابط أو يُسحب. تنتهي صلاحية هذا الرابط في',
      'privacy.reader.anyoneWithThisLink': 'أي شخص لديه هذا الرابط',
    },
    fr: {
      'consequence.heading': 'Ce qui se passe quand vous appuyez sur Envoyer la réponse',
      'consequence.what': 'Ce qui est envoyé',
      'consequence.whatBody':
        'Le texte saisi dans la zone de réponse, enregistré comme votre propre déclaration. Une seule réponse est conservée par demande, et une autre ne pourra plus être envoyée ensuite.',
      'consequence.until': "Jusqu'à quand",
      'consequence.untilBody':
        "Au plus jusqu'à ce que le lien expire ou soit retiré. Ce lien expire le",
      'privacy.reader.anyoneWithThisLink': 'Toute personne disposant de ce lien',
    },
    de: {
      'consequence.heading': 'Was passiert, wenn Sie auf Antwort senden drücken',
      'consequence.what': 'Was gesendet wird',
      'consequence.whatBody':
        'Der Text im Antwortfeld, erfasst als Ihre eigene Erklärung. Pro Anfrage wird eine Antwort gespeichert, danach kann keine andere mehr gesendet werden.',
      'consequence.until': 'Bis wann',
      'consequence.untilBody':
        'Höchstens bis der Link abläuft oder zurückgezogen wird. Dieser Link läuft ab am',
      'privacy.reader.anyoneWithThisLink': 'Jede Person mit diesem Link',
    },
  };
