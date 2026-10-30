import type { FormCatalog } from './en';

// Bangla request form words. Agent draft, not reviewed: shown only where the owner has released Bangla in
// CORRIDRA_LANGUAGES_FORM after a recorded review (docs/product/language-review-record.md). Modern business
// Bangla; counts inside sentences use Bengali digits, while the amount hint names the digits 0 to 9 the amount
// reader accepts.
export const words: FormCatalog = {
  'form.head.label': 'মিশন পরিকল্পনা',
  'form.head.title': 'আপনি কী করতে চান?',
  'form.head.realLead': 'আপনার লক্ষ্য দিয়ে শুরু করুন।',
  'form.head.sampleLead': 'ছোট একটি অনুরোধই যথেষ্ট। কোনো অ্যাকাউন্ট লাগবে না।',

  'form.notice.realPill': 'আপনার অনুরোধ',
  'form.notice.realLead': 'যে কাজটি দরকার, তা দিয়ে শুরু করুন।',
  'form.notice.samplePill': 'নমুনা মোড',
  'form.notice.sampleLead': 'নমুনা অনুরোধ চালু আছে। প্রকৃত গ্রাহকের মিশন গ্রহণ করা হচ্ছে না।',
  'form.notice.sampleUse':
    'কাল্পনিক তথ্য এবং {domain} দিয়ে শেষ হওয়া একটি ইমেইল ঠিকানা ব্যবহার করুন।',
  'form.notice.sampleReceipt': 'উত্তর পড়তে আপনার রসিদ রেখে দিন।',
  'form.notice.sampleEmail': 'ইমেইল পাঠানো চালু নেই।',
  'form.notice.englishParts':
    'গোপনীয়তা, সম্মতি ও তথ্য কতদিন রাখা হয়, এসব বিষয়ের বাক্য ইংরেজিতে আছে।',

  'form.pending.title': 'আপনার অনুরোধ সম্পূর্ণ করুন।',
  'form.pending.sameDevice':
    'একই ডিভাইস ও একই ব্রাউজার ব্যবহার করুন। এই ধাপের পরে অনুরোধটি Corridra-তে পাঠানো হবে।',
  'form.pending.open': 'আপনার অনুরোধ খুলুন',
  'form.pending.activate': 'অ্যাকাউন্ট চালু করুন',
  'form.pending.signIn': 'সাইন ইন করে এগিয়ে যান',
  'form.pending.create': 'অ্যাকাউন্ট খুলুন',
  'form.pending.codeSignIn': 'কোড দিয়ে সাইন ইন করে অনুরোধ দেখুন',
  'form.pending.return': 'ফর্মে ফিরে যান',

  'form.step.counter': 'ধাপ {step} / {total}',
  'form.step.goal': 'লক্ষ্য',
  'form.step.where': 'কোথায়',
  'form.step.details': 'বিবরণ',
  'form.step.results': 'ফলাফল',
  'form.step.contact': 'যোগাযোগ',
  'form.step.journey': 'অনুরোধের ধাপগুলো',
  'form.step.progress': 'অনুরোধের অগ্রগতি',
  'form.step.titleGoal': 'আপনি কী অর্জন করতে চান?',
  'form.step.titleWhere': 'কোথায়?',
  'form.step.titleDetails': 'আপনি কী দিচ্ছেন বা কী খুঁজছেন?',
  'form.step.titleResults': 'কোন ফল পেলে এটি আপনার কাজে আসবে?',
  'form.step.titleContact': 'আমরা কোথায় উত্তর দেব?',

  'form.summary.title': 'এই ধাপটি দেখে নিন।',
  'form.summary.body': 'এগোনোর আগে চিহ্নিত ঘরগুলো দেখে নিন। আপনার দেওয়া তথ্য এখানেই আছে।',

  'form.goal.legend': 'মিশনের লক্ষ্য',
  'form.goal.sell': 'নতুন বাজারে বিক্রি করা',
  'form.goal.customers': 'গ্রাহক বা পরিবেশক খোঁজা',
  'form.goal.source': 'সরবরাহকারী খোঁজা',
  'form.goal.trip': 'আসন্ন ব্যবসায়িক সফরকে আরও ফলপ্রসূ করা',
  'form.goal.mission': 'একাধিক প্রতিষ্ঠানের মিশন পরিচালনা করা',
  'form.goal.other': 'অন্য কিছু',
  'form.goal.job': 'ব্যবসায়িক কাজ',
  'form.goal.choose': 'কাজ বেছে নিন',
  'form.goal.hint': 'জানা থাকলে আরও নির্দিষ্ট কাজ বেছে নিন।',

  'form.job.buyers': 'ক্রেতা খোঁজা',
  'form.job.customers': 'গ্রাহক খোঁজা',
  'form.job.distributors': 'পরিবেশক খোঁজা',
  'form.job.partners': 'ব্যবসায়িক অংশীদার খোঁজা',
  'form.job.sourcing': 'পণ্য বা যন্ত্রাংশ সংগ্রহ',
  'form.job.machinery_procurement': 'যন্ত্রপাতি কেনা',
  'form.job.supplier_evaluation': 'সরবরাহকারী যাচাই',
  'form.job.meetings': 'ব্যবসায়িক বৈঠকের ব্যবস্থা',
  'form.job.factory_visits': 'সাইট পরিদর্শন',
  'form.job.trade_fairs': 'বাণিজ্য মেলা থেকে আরও ফল পাওয়া',
  'form.job.business_trips': 'ব্যবসায়িক সফরের পরিকল্পনা ও বাস্তবায়ন',
  'form.job.market_validation': 'বাজার যাচাই',
  'form.job.market_entry': 'বাজারে প্রবেশ',
  'form.job.export_market_access': 'রপ্তানির সুযোগ তৈরি',
  'form.job.delegations': 'একাধিক প্রতিষ্ঠানের মিশন পরিচালনা করা',

  'form.where.company': 'প্রতিষ্ঠানটি কোন দেশে অবস্থিত?',
  'form.where.chooseCountry': 'একটি দেশ বেছে নিন',
  'form.where.market': 'কোন বাজার নিয়ে কাজ?',
  'form.where.chooseMarket': 'একটি বাজার বেছে নিন',
  'form.where.eu': 'ইউরোপীয় ইউনিয়ন (বাণিজ্য জোট)',
  'form.where.hint':
    'প্রতিষ্ঠানের দেশ ও লক্ষ্য বাজার দিয়ে চালানের স্থান বা বৈঠকের স্থান ঠিক হয় না।',
  'form.where.realOther':
    'আপনার কী দরকার, তা জানান। এই দিকের জন্য প্রাপ্যতা ও পরিধি পর্যালোচনার পরে ঠিক করা হবে।',
  'form.where.sampleOther':
    'এই দিকের জন্য কোনো চালু সেবা ঘোষণা করা হয়নি। তবু আপনি একটি কাল্পনিক নমুনা মিশন লিখতে পারেন।',
  'form.where.when': 'কাজটি কবে দরকার? (ঐচ্ছিক)',
  'form.where.attendance': 'আপনি কি সশরীরে উপস্থিত থাকবেন?',
  'form.where.yes': 'হ্যাঁ',
  'form.where.no': 'না',
  'form.where.undecided': 'ঠিক হয়নি',
  'form.where.from': 'থেকে',
  'form.where.to': 'পর্যন্ত',
  'form.where.timezone': 'পরিদর্শনের সময় অঞ্চল',

  'form.details.offer': 'আপনার প্রস্তাব বা প্রয়োজন',
  'form.details.offerExample':
    'উদাহরণ: আমরা বাংলাদেশে হোটেলের তোয়ালে তৈরি করি এবং প্রাইভেট লেবেল পণ্য কেনেন এমন স্প্যানিশ হসপিটালিটি পরিবেশকদের সঙ্গে দেখা করতে চাই।',
  'form.details.offerHint':
    'যা জানেন, তা দিয়ে শুরু করুন। পণ্যের ছবি, একটি ধারণা, বর্তমান সরবরাহকারী বা একটি মূল্য উদ্ধৃতি বর্ণনা করতে পারেন। বাকি স্পেসিফিকেশন পরে স্পষ্ট করা যাবে। এখানে ছবি বিশ্লেষণের সুবিধা নেই।',
  'form.details.technicalPurpose': 'কারিগরি উদ্দেশ্য (ঐচ্ছিক)',
  'form.details.technicalParameters': 'মূল কারিগরি মান (ঐচ্ছিক)',
  'form.details.siteConstraints': 'সাইট, সংযোজন বা বিক্রয়-পরবর্তী সেবার শর্ত (ঐচ্ছিক)',
  'form.details.specifications': 'পণ্যের স্পেসিফিকেশন (ঐচ্ছিক)',
  'form.details.quantity': 'প্রয়োজনীয় পরিমাণ (ঐচ্ছিক)',
  'form.details.unit': 'পরিমাণের একক (পরিমাণ দিলে আবশ্যক)',
  'form.details.supplierPreferences': 'সরবরাহকারী নিয়ে পছন্দ ও শর্ত (ঐচ্ছিক)',
  'form.details.targetBuyer': 'লক্ষ্য ক্রেতা বা পরিবেশক (ঐচ্ছিক)',
  'form.details.readiness': 'ব্যবসায়িক প্রস্তুতি ও শর্ত (ঐচ্ছিক)',
  'form.details.organiser': 'প্রতিনিধিদলের আয়োজক (ঐচ্ছিক)',
  'form.details.participants': 'অংশগ্রহণকারী প্রতিষ্ঠান ও প্রত্যেকের প্রয়োজন (ঐচ্ছিক)',
  'form.details.delegationHint': 'প্রত্যেক অংশগ্রহণকারী আলাদা একটি মিশন পান।',
  'form.details.website': 'ওয়েবসাইট বা ক্যাটালগের URL (ঐচ্ছিক)',
  'form.details.websiteHint':
    'একটি পাবলিক লিংক কাজে আসে। আমরা এটি নিজে থেকে খুলি না। পর্যালোচনার পরে নথি চাওয়া হতে পারে।',

  'form.budget.summary': 'বাজেট (ঐচ্ছিক)',
  'form.budget.amount': 'মূল মুদ্রায় বাজেট (ঐচ্ছিক)',
  'form.budget.currency': 'মূল মুদ্রা',
  'form.budget.none': 'বাজেট দেওয়া হয়নি',
  'form.budget.option': '{code} ({places} দশমিক ঘর)',
  'form.budget.basis': 'বাজেটের ভিত্তি, যেমন যন্ত্রপাতির মোট বাজেট',
  'form.budget.hint':
    'উদ্ধৃত মূল্য যেভাবে আছে সেভাবে লিখুন, যেমন {cny} বা {bhd}। 0 থেকে 9 অঙ্ক ব্যবহার করুন। নির্বাচিত মুদ্রার দশমিক ঘর মেনে লিখুন। কোনো মুদ্রা রূপান্তর করা হয় না।',

  'form.results.worthwhile': 'কোন ফল পেলে এই কাজটি সার্থক হবে? (ঐচ্ছিক)',
  'form.results.legend': 'কাঙ্ক্ষিত ফলাফল',
  'form.results.meetings': 'প্রাসঙ্গিক বৈঠক',
  'form.results.buyers': 'ক্রেতা / গ্রাহক',
  'form.results.distributors': 'পরিবেশকের সঙ্গে আলোচনা',
  'form.results.supplierVisits': 'সরবরাহকারী পরিদর্শন',
  'form.results.validation': 'বাজার যাচাই',
  'form.results.intelligence': 'স্থানীয় ব্যবসায়িক তথ্য',
  'form.results.other': 'অন্য কিছু',
  'form.results.notes': 'আমাদের বিশেষ কিছু জানা দরকার? (ঐচ্ছিক)',
  'form.results.contextHint':
    'কাজটি এখন কোন অবস্থায় আছে এবং পরের ধাপে কী সাহায্য দরকার, তা জানান। বর্তমান সরবরাহকারী, অনুমোদিত স্পেসিফিকেশন, বুক করা সফর বা চলমান আলোচনা আপনার শুরুর জায়গা হতে পারে।',

  'form.contact.name': 'নাম',
  'form.contact.company': 'প্রতিষ্ঠান',
  'form.contact.email': 'কাজের ইমেইল',
  'form.contact.password': 'অ্যাকাউন্টের পাসওয়ার্ড তৈরি করুন',
  'form.contact.passwordHint': 'কমপক্ষে ১৪টি অক্ষর ব্যবহার করুন।',
  'form.contact.signedInAs': '{email} হিসেবে সাইন ইন করা আছে।',
  'form.contact.haveAccount': 'আগে থেকেই অ্যাকাউন্ট আছে?',
  'form.contact.signInReturn': 'সাইন ইন করে এই অনুরোধে ফিরে আসুন',
  'form.contact.realHint': 'আমরা আপনার অনুরোধ পর্যালোচনা করে পরের ধাপ প্রস্তাব করি।',
  'form.contact.sampleHint':
    'কোনো অ্যাকাউন্ট লাগবে না। আমরা আগে আপনার অনুরোধ পর্যালোচনা করি, তারপর পরের ধাপ প্রস্তাব করি। উত্তর পড়তে আপনার রসিদ ব্যবহার করুন।',

  'form.action.back': 'পেছনে',
  'form.action.continue': 'এগিয়ে যান',
  'form.action.saving': 'সংরক্ষণ হচ্ছে…',
  'form.action.createAccount': 'অ্যাকাউন্ট খুলে এগিয়ে যান',
  'form.action.submit': 'অনুরোধ পাঠান',
  'form.action.clearDraft': 'খসড়া মুছুন',

  'form.receipt.label': 'অনুরোধ সংরক্ষিত',
  'form.receipt.title': 'আপনার ব্যক্তিগত রসিদ রেখে দিন।',
  'form.receipt.saveBeforeClosing': 'এই ট্যাব বন্ধ করার আগে এটি সংরক্ষণ করুন।',
  'form.receipt.forget': 'এই ডিভাইসে অনুরোধটি ভুলে যান',
  'form.receipt.code': 'ব্যক্তিগত রসিদ কোড',
  'form.receipt.copy': 'রসিদ কোড কপি করুন',
  'form.receipt.another': 'নতুন অনুরোধ শুরু করুন (আগে রসিদ রাখুন)',

  'form.check.realTitle': 'আগের একটি রসিদ যাচাই করুন।',
  'form.check.sampleTitle': 'একটি মিশন অনুরোধ যাচাই করুন।',
  'form.check.code': 'রসিদ কোড',
  'form.check.submit': 'অবস্থা ও উত্তর দেখুন',
  'form.check.status': 'অবস্থা: {status}',
  'form.check.noReply': 'Corridra টিম থেকে এখনও কোনো উত্তর আসেনি।',

  'form.side.realLabel': 'আপনার অনুরোধ',
  'form.side.sampleLabel': 'আপনার নমুনা অনুরোধ',
  'form.side.realHeading': 'আপনার অনুরোধ',
  'form.side.sampleHeading': 'আপনার নমুনা অনুরোধ',
  'form.side.objective': 'লক্ষ্য',
  'form.side.country': 'প্রতিষ্ঠানের দেশ',
  'form.side.market': 'লক্ষ্য বাজার',
  'form.side.budget': 'মূল বাজেট',
  'form.side.notChosen': 'বেছে নেওয়া হয়নি',
  'form.side.noCurrency': '(মুদ্রা বেছে নেওয়া হয়নি)',
  'form.side.notSupplied': 'দেওয়া হয়নি',
  'form.side.draftOnly': 'এটি শুধু খসড়া।',

  'form.message.claimFailed': 'আপনার অনুরোধ পাঠানো যায়নি। আবার চেষ্টা করুন।',
  'form.message.claimUnreadable': 'অনুরোধের উত্তর পড়া যায়নি। যাচাই করতে আপনার অ্যাকাউন্ট খুলুন।',
  'form.message.navigationMissing':
    'অনুরোধের পাতা খোলা যাচ্ছে না। এগিয়ে যেতে আপনার অ্যাকাউন্ট খুলুন।',
  'form.message.draftLostReal':
    'সংরক্ষিত খসড়া ফিরিয়ে আনা যায়নি। এই ট্যাব ছাড়ার আগে আপনার অনুরোধের একটি কপি রাখুন।',
  'form.message.draftLostSample':
    'সংরক্ষিত খসড়া ফিরিয়ে আনা যায়নি। ফর্মটি এখনও কাজ করছে। এই ট্যাব ছাড়ার আগে আপনার কাল্পনিক অনুরোধের একটি কপি রাখুন।',
  'form.message.draftResumed':
    'এই ট্যাবের একটি খসড়া আবার চালু হয়েছে। লিংকের পরামর্শের চেয়ে আপনার সংরক্ষিত পছন্দ অগ্রাধিকার পায়।',
  'form.message.draftNotResumed': 'আগের খসড়াটি আবার চালু করা যায়নি।',
  'form.message.accountUnchecked':
    'অ্যাকাউন্টের অবস্থা যাচাই করা যায়নি। সাইন ইন করুন বা আবার চেষ্টা করুন।',
  'form.message.pendingUnchecked': 'সংরক্ষিত অনুরোধের অবস্থা যাচাই করা যায়নি। আবার চেষ্টা করুন।',
  'form.message.paused':
    'নতুন অনুরোধ নেওয়া আপাতত বন্ধ আছে। আগের অনুরোধগুলো আপনার অ্যাকাউন্টে পাওয়া যাবে।',
  'form.message.opening': 'আপনার ব্যক্তিগত অনুরোধ খোলা হচ্ছে…',
  'form.message.accountFailed': 'আপনার অ্যাকাউন্ট যাচাই করা যায়নি।',
  'form.message.draftUnsavedReal':
    'এই ব্রাউজার খসড়াটি সংরক্ষণ করতে পারেনি। ট্যাবটি খোলা রাখুন এবং যাওয়ার আগে আপনার অনুরোধ কপি করুন।',
  'form.message.draftUnsavedSample':
    'এই ব্রাউজার খসড়াটি সংরক্ষণ করতে পারেনি। ট্যাবটি খোলা রাখুন এবং যাওয়ার আগে কাল্পনিক অনুরোধটি কপি করুন।',
  'form.message.chooseJob': 'ব্যবসায়িক কাজটি বেছে নিন।',
  'form.message.chooseCountry': 'প্রতিষ্ঠানের দেশ বেছে নিন।',
  'form.message.chooseMarket': 'লক্ষ্য বাজার বেছে নিন।',
  'form.message.checkAmount': 'মূল পরিমাণ ও মুদ্রা যাচাই করুন।',
  'form.message.pausedSubmit':
    'নতুন অনুরোধ নেওয়া আপাতত বন্ধ আছে। আগের কাজের জন্য আপনার অ্যাকাউন্ট খুলুন।',
  'form.message.accountLoading': 'আপনার অ্যাকাউন্টের অবস্থা লোড হওয়া পর্যন্ত অপেক্ষা করুন।',
  'form.message.emailMismatch':
    'সাইন ইন করা অ্যাকাউন্টের ইমেইল ঠিকানা ব্যবহার করুন, অথবা অন্য অ্যাকাউন্ট ব্যবহার করতে সাইন আউট করুন।',
  'form.message.passwordShort': 'কমপক্ষে ১৪টি অক্ষরের একটি অ্যাকাউন্ট পাসওয়ার্ড বেছে নিন।',
  'form.message.notSaved': 'আপনার অনুরোধ সংরক্ষণ করা যায়নি। আপনার দেওয়া তথ্য এখানেই আছে।',
  'form.message.accountNotCreated':
    'আপনার অ্যাকাউন্ট খোলা যায়নি। সাইন ইন করে দেখুন অথবা নিচে অ্যাকাউন্ট খুলুন।',
  'form.message.duplicate': 'এই কাল্পনিক নমুনা অনুরোধটি আগেই নথিভুক্ত হয়েছে।',
  'form.message.recorded': 'আপনার কাল্পনিক নমুনা অনুরোধটি নথিভুক্ত হয়েছে।',
  'form.message.receiptUnsaved':
    'অনুরোধটি নথিভুক্ত হয়েছে, কিন্তু এই ব্রাউজার রসিদটি সংরক্ষণ করতে পারেনি। যাওয়ার আগে ব্যক্তিগত কোডটি কপি করুন।',
  'form.message.unableToSave': 'সংরক্ষণ করা যায়নি। আপনার দেওয়া তথ্য এখানেই আছে।',
  'form.message.copied': 'ব্যক্তিগত রসিদ কোড কপি হয়েছে।',
  'form.message.copyFailed':
    'কোডটি কপি করা যায়নি। এই পাতা ছাড়ার আগে কোডটি নির্বাচন করে কপি করুন।',
  'form.message.unableToCheck': 'রসিদ যাচাই করা যায়নি।',
  'form.message.openFailed': 'আপনার অনুরোধ খোলা যায়নি।',
  'form.message.untranslated': 'এই বার্তাটি ইংরেজিতে দেখানো হচ্ছে।',
  'form.message.consentLead': 'নোটিশটি পড়ুন এবং এগোতে বাক্সে টিক দিন।',
};
