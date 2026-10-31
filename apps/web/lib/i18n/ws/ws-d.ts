import type { Locale } from '../locales';

// WS-D message block (commercial readiness program, D16 and 3.3). Only WS-D edits this file.
// Keys start with "wsd.". English is the source; every other language needs the same keys. The
// translations are drafts until a native reviewer is recorded in docs/qa/2026-10-31/i18n-review.md.
// Privacy and consent lines stay in English.
export const wsDEn = {
  'wsd.liveState': 'Live, small scale',
  'wsd.deferredBy': 'Deferred by owner decision on {date}',
  'wsd.scannerLine': 'Files are checked for type and size. Virus scanning is deferred.',
  'wsd.myEvidence': 'My submitted evidence',
  'wsd.waitingReviewer': 'Waiting for another reviewer',
  'wsd.chooseDecision': 'Choose a decision',
  'wsd.invitationSent': 'Invitation sent.',
  'wsd.inviteTeamMember': 'Invite a team member',
  'wsd.resetAuthenticator': 'Reset authenticator',
  'wsd.technicalDetails': 'Technical details',
  'wsd.notAvailable': 'Not available',
  'wsd.sessionWarning':
    'This browser is signed in to a Corridra team workspace. Signing in with the new account ends that session here.',
} as const;

export const wsD: Record<Exclude<Locale, 'en'>, Record<keyof typeof wsDEn, string>> = {
  bn: {
    'wsd.liveState': 'চালু, ছোট পরিসরে',
    'wsd.deferredBy': '{date} তারিখে মালিকের সিদ্ধান্তে স্থগিত',
    'wsd.scannerLine': 'ফাইলের ধরন ও আকার যাচাই করা হয়। ভাইরাস স্ক্যান আপাতত স্থগিত।',
    'wsd.myEvidence': 'আমার জমা দেওয়া প্রমাণ',
    'wsd.waitingReviewer': 'অন্য একজন পর্যালোচকের অপেক্ষায়',
    'wsd.chooseDecision': 'একটি সিদ্ধান্ত বেছে নিন',
    'wsd.invitationSent': 'আমন্ত্রণ পাঠানো হয়েছে।',
    'wsd.inviteTeamMember': 'দলের সদস্যকে আমন্ত্রণ জানান',
    'wsd.resetAuthenticator': 'অথেনটিকেটর রিসেট করুন',
    'wsd.technicalDetails': 'প্রযুক্তিগত বিবরণ',
    'wsd.notAvailable': 'পাওয়া যাচ্ছে না',
    'wsd.sessionWarning':
      'এই ব্রাউজারে একটি Corridra টিম ওয়ার্কস্পেসে সাইন ইন করা আছে। নতুন অ্যাকাউন্টে সাইন ইন করলে এখানে সেই সেশন শেষ হবে।',
  },
  zh: {
    'wsd.liveState': '已上线，小规模运营',
    'wsd.deferredBy': '经所有者于 {date} 决定推迟',
    'wsd.scannerLine': '文件会检查类型和大小。病毒扫描暂缓。',
    'wsd.myEvidence': '我提交的证据',
    'wsd.waitingReviewer': '等待另一位审核人',
    'wsd.chooseDecision': '请选择决定',
    'wsd.invitationSent': '邀请已发送。',
    'wsd.inviteTeamMember': '邀请团队成员',
    'wsd.resetAuthenticator': '重置身份验证器',
    'wsd.technicalDetails': '技术细节',
    'wsd.notAvailable': '暂不可用',
    'wsd.sessionWarning':
      '此浏览器已登录 Corridra 团队工作区。使用新账户登录后，此处的团队会话将结束。',
  },
  es: {
    'wsd.liveState': 'En funcionamiento, a pequeña escala',
    'wsd.deferredBy': 'Aplazado por decisión del propietario el {date}',
    'wsd.scannerLine':
      'Se comprueban el tipo y el tamaño de los archivos. El análisis de virus está aplazado.',
    'wsd.myEvidence': 'Mis pruebas enviadas',
    'wsd.waitingReviewer': 'Esperando a otro revisor',
    'wsd.chooseDecision': 'Elige una decisión',
    'wsd.invitationSent': 'Invitación enviada.',
    'wsd.inviteTeamMember': 'Invitar a un miembro del equipo',
    'wsd.resetAuthenticator': 'Restablecer el autenticador',
    'wsd.technicalDetails': 'Detalles técnicos',
    'wsd.notAvailable': 'No disponible',
    'wsd.sessionWarning':
      'Este navegador tiene una sesión abierta en un espacio de equipo de Corridra. Al entrar con la cuenta nueva, esa sesión se cerrará aquí.',
  },
  ar: {
    'wsd.liveState': 'يعمل، على نطاق صغير',
    'wsd.deferredBy': 'مؤجل بقرار من المالك في {date}',
    'wsd.scannerLine': 'يتم فحص نوع الملفات وحجمها. فحص الفيروسات مؤجل.',
    'wsd.myEvidence': 'الأدلة التي قدمتها',
    'wsd.waitingReviewer': 'بانتظار مراجع آخر',
    'wsd.chooseDecision': 'اختر قرارًا',
    'wsd.invitationSent': 'تم إرسال الدعوة.',
    'wsd.inviteTeamMember': 'دعوة عضو في الفريق',
    'wsd.resetAuthenticator': 'إعادة تعيين أداة المصادقة',
    'wsd.technicalDetails': 'التفاصيل التقنية',
    'wsd.notAvailable': 'غير متاح',
    'wsd.sessionWarning':
      'هذا المتصفح مسجّل الدخول إلى مساحة فريق في Corridra. عند تسجيل الدخول بالحساب الجديد تنتهي تلك الجلسة هنا.',
  },
  fr: {
    'wsd.liveState': 'En service, à petite échelle',
    'wsd.deferredBy': 'Reporté par décision du propriétaire le {date}',
    'wsd.scannerLine':
      'Le type et la taille des fichiers sont vérifiés. L’analyse antivirus est reportée.',
    'wsd.myEvidence': 'Mes preuves envoyées',
    'wsd.waitingReviewer': 'En attente d’un autre relecteur',
    'wsd.chooseDecision': 'Choisissez une décision',
    'wsd.invitationSent': 'Invitation envoyée.',
    'wsd.inviteTeamMember': 'Inviter un membre de l’équipe',
    'wsd.resetAuthenticator': 'Réinitialiser l’authentificateur',
    'wsd.technicalDetails': 'Détails techniques',
    'wsd.notAvailable': 'Non disponible',
    'wsd.sessionWarning':
      'Ce navigateur est connecté à un espace d’équipe Corridra. La connexion avec le nouveau compte met fin à cette session ici.',
  },
  de: {
    'wsd.liveState': 'In Betrieb, in kleinem Umfang',
    'wsd.deferredBy': 'Am {date} durch Entscheidung des Inhabers zurückgestellt',
    'wsd.scannerLine':
      'Dateien werden auf Typ und Größe geprüft. Der Virenscan ist zurückgestellt.',
    'wsd.myEvidence': 'Meine eingereichten Nachweise',
    'wsd.waitingReviewer': 'Wartet auf eine andere prüfende Person',
    'wsd.chooseDecision': 'Entscheidung wählen',
    'wsd.invitationSent': 'Einladung gesendet.',
    'wsd.inviteTeamMember': 'Teammitglied einladen',
    'wsd.resetAuthenticator': 'Authenticator zurücksetzen',
    'wsd.technicalDetails': 'Technische Details',
    'wsd.notAvailable': 'Nicht verfügbar',
    'wsd.sessionWarning':
      'Dieser Browser ist in einem Corridra-Teambereich angemeldet. Mit der Anmeldung im neuen Konto endet diese Sitzung hier.',
  },
};
