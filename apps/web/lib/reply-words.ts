// The Reply Page's own words, in English and a limited Chinese catalogue (ADR-069). The team sets the
// language per recipient in the link, so no browser setting or cookie decides it. Only the page's own
// words are translated: names, quotations, currencies, the requirement text and anything a person typed
// stay exactly as written. The Chinese is a draft until a native reviewer is recorded
// (docs/product/language-review-record.md); the English is the source.
import type { ReplyError, ReplyGroup, ReplyTermKey } from './reply-terms';
import type { ReplyLanguage } from './reply-terms';

export type ReplyWords = {
  step: string;
  back: string;
  next: string;
  stepAnswer: string;
  stepMessage: string;
  stepQuote: Record<ReplyGroup, string>;
  stepCheck: string;
  stepReceipt: string;
  answerQuestion: string;
  interested: string;
  needInfo: string;
  notRelevant: string;
  optOut: string;
  stop: string;
  retrySame: string;
  recorded: string;
  expires: string;
  aboutIntro: string;
  requirementLabel: string;
  messageLabel: string;
  messageHelp: string;
  meetingInterest: string;
  addQuote: string;
  skipQuote: string;
  quoteIntro: string;
  askedTitle: string;
  askedMark: string;
  currency: string;
  chooseCurrency: string;
  uncertainties: string;
  uncertaintiesHelp: string;
  notStated: string;
  noCharge: string;
  chargeAmount: string;
  fields: Record<ReplyTermKey, string>;
  hints: Partial<Record<ReplyTermKey, string>>;
  shippingValues: { INCLUDED: string; EXCLUDED: string; NOT_SUPPLIED: string };
  chooseOne: string;
  errors: Record<ReplyError, string>;
  messageTooShort: string;
  checkIntro: string;
  checkYourAnswer: string;
  checkMeeting: string;
  checkQuote: string;
  checkNoQuote: string;
  acknowledge: string;
  send: string;
  sending: string;
  notAcknowledged: string;
  receiptTitle: string;
  receiptIntro: string;
  receiptSource: string;
  receiptCopy: string;
  receiptCopied: string;
  receiptDownload: string;
  receiptHeading: string;
  receiptRecordedOn: string;
  sampleOnly: string;
  noMailingList: string;
  loading: string;
  unavailable: string;
};

const en: ReplyWords = {
  step: 'Step {n} of {total}',
  back: 'Back',
  next: 'Next',
  stepAnswer: 'Your answer',
  stepMessage: 'Your message',
  stepQuote: {
    what: 'Your quote: what you offer',
    price: 'Your quote: the price',
    terms: 'Your quote: the terms',
    included: 'Your quote: what is included',
  },
  stepCheck: 'Check what you typed',
  stepReceipt: 'Your receipt',
  answerQuestion: 'Would this company be relevant to you?',
  interested: 'Interested',
  needInfo: 'Need more information',
  notRelevant: 'Not relevant',
  optOut: 'Do not send me further introductions from this workspace',
  stop: 'Stop further introductions',
  retrySame: 'Retry the same response',
  recorded: 'Thank you. Your answer has been recorded.',
  expires: 'This private link expires {date}.',
  aboutIntro: 'About this introduction',
  requirementLabel: 'What was shared with you',
  messageLabel: 'Your message to the team',
  messageHelp: 'A few words are enough. You can add a quote on the next steps.',
  meetingInterest:
    'I would like to discuss a meeting or visit. This is interest, not a confirmed appointment.',
  addQuote: 'Add a quote',
  skipQuote: 'Send my message without a quote',
  quoteIntro:
    'Fill in only what you know. Anything you leave blank is recorded as not stated, never as zero.',
  askedTitle: 'The team asked for these',
  askedMark: 'Asked for',
  currency: 'Currency of your quote',
  chooseCurrency: 'Choose a currency',
  uncertainties: 'What is missing or uncertain in this quote',
  uncertaintiesHelp: 'Say what you could not give yet. Three words are enough.',
  notStated: 'Not stated',
  noCharge: 'No charge',
  chargeAmount: 'An amount',
  fields: {
    specification: 'What you are quoting',
    quantity: 'Quantity',
    moq: 'Minimum order',
    unit: 'Unit (for example pieces or sets)',
    unitPriceMinor: 'Price for one unit',
    totalPriceMinor: 'Total price',
    toolingMinor: 'Tooling',
    setupMinor: 'Set-up',
    packagingMinor: 'Packaging',
    leadTime: 'Lead time',
    validUntil: 'This quote is valid until',
    incoterm: 'Trade term',
    paymentTerms: 'Payment terms',
    shipping: 'Shipping',
    warranty: 'Warranty',
    installation: 'Installation',
    training: 'Training',
    spares: 'Spare parts',
  },
  hints: {
    unitPriceMinor: 'In the currency above, for example 12.50',
    totalPriceMinor: 'In the currency above',
    validUntil: 'The last day you will honour this quote',
    incoterm: 'The agreed delivery term, for example FOB or DAP',
  },
  shippingValues: {
    INCLUDED: 'Included in the price',
    EXCLUDED: 'Not included in the price',
    NOT_SUPPLIED: 'Not stated',
  },
  chooseOne: 'Not stated',
  errors: {
    text: 'Use between 3 and 1,000 characters, or leave it blank.',
    unit: 'Use between 1 and 80 characters, or leave it blank.',
    integer: 'Use a whole number above zero, or leave it blank.',
    amount: 'Use numbers with a period for decimals, for example 12.50.',
    places: 'This currency allows fewer decimal places. Nothing is rounded for you.',
    range: 'This amount is too large.',
    date: 'Use a real date.',
    incoterm: 'Choose one of the trade terms in the list.',
    shipping: 'Choose one of the options in the list.',
    currency: 'Choose the currency of your quote.',
  },
  messageTooShort: 'Write at least 3 characters.',
  checkIntro: 'Check this before you send it. You cannot change it afterwards.',
  checkYourAnswer: 'Your message',
  checkMeeting: 'You would like to discuss a meeting or visit. No appointment is confirmed.',
  checkQuote: 'Your quote',
  checkNoQuote: 'No quote is included.',
  acknowledge:
    'This is my own declaration for this request. I understand that the Corridra team will review it before anyone else sees it.',
  send: 'Send',
  sending: 'Sending',
  notAcknowledged: 'Tick the box to confirm.',
  receiptTitle: 'Your answer is recorded',
  receiptIntro: 'Keep this receipt. It is a copy of what you sent.',
  receiptSource:
    'Recorded as your own declaration. The team will review it. No meeting, approval or verification is assumed.',
  receiptCopy: 'Copy the receipt',
  receiptCopied: 'Copied',
  receiptDownload: 'Download as a text file',
  receiptHeading: 'Corridra receipt',
  receiptRecordedOn: 'Recorded on',
  sampleOnly: '(madeup) Sample introduction. No real outreach.',
  noMailingList: 'You will not be added to a mailing list by responding.',
  loading: 'Loading your introduction',
  unavailable: 'This private link is unavailable. Open the complete link you received.',
};

const zh: ReplyWords = {
  step: '第 {n} 步，共 {total} 步',
  back: '返回',
  next: '下一步',
  stepAnswer: '您的回答',
  stepMessage: '您的留言',
  stepQuote: {
    what: '您的报价：产品内容',
    price: '您的报价：价格',
    terms: '您的报价：条款',
    included: '您的报价：包含内容',
  },
  stepCheck: '请检查您填写的内容',
  stepReceipt: '您的回执',
  answerQuestion: '这家公司与您相关吗？',
  interested: '有兴趣',
  needInfo: '需要更多信息',
  notRelevant: '不相关',
  optOut: '不要再从此工作区向我发送介绍',
  stop: '停止后续介绍',
  retrySame: '重新提交同一回答',
  recorded: '谢谢。您的回答已记录。',
  expires: '此私人链接于 {date} 到期。',
  aboutIntro: '关于这次介绍',
  requirementLabel: '与您共享的内容',
  messageLabel: '给团队的留言',
  messageHelp: '写几个字即可。下一步可以添加报价。',
  meetingInterest: '我想商谈会面或参观。这只表示意向，并非已确认的预约。',
  addQuote: '添加报价',
  skipQuote: '只发送留言，不附报价',
  quoteIntro: '只填写您已知的内容。留空的项目会记录为“未说明”，不会记为零。',
  askedTitle: '团队希望您补充以下内容',
  askedMark: '团队要求',
  currency: '报价币种',
  chooseCurrency: '选择币种',
  uncertainties: '此报价中缺少或不确定的内容',
  uncertaintiesHelp: '请说明目前无法提供的内容。写三个字即可。',
  notStated: '未说明',
  noCharge: '免费',
  chargeAmount: '填写金额',
  fields: {
    specification: '报价产品',
    quantity: '数量',
    moq: '最小起订量',
    unit: '单位（例如件或套）',
    unitPriceMinor: '单价',
    totalPriceMinor: '总价',
    toolingMinor: '模具费',
    setupMinor: '设置费',
    packagingMinor: '包装费',
    leadTime: '交货期',
    validUntil: '此报价有效期至',
    incoterm: '贸易术语',
    paymentTerms: '付款条款',
    shipping: '运输',
    warranty: '质保',
    installation: '安装',
    training: '培训',
    spares: '备件',
  },
  hints: {
    unitPriceMinor: '使用上面选择的币种，例如 12.50',
    totalPriceMinor: '使用上面选择的币种',
    validUntil: '您愿意按此报价履约的最后一天',
    incoterm: '约定的交货术语，例如 FOB 或 DAP',
  },
  shippingValues: {
    INCLUDED: '已含在价格内',
    EXCLUDED: '不含在价格内',
    NOT_SUPPLIED: '未说明',
  },
  chooseOne: '未说明',
  errors: {
    text: '请填写 3 到 1,000 个字符，或留空。',
    unit: '请填写 1 到 80 个字符，或留空。',
    integer: '请填写大于零的整数，或留空。',
    amount: '请使用数字，小数点用句点，例如 12.50。',
    places: '此币种允许的小数位更少。系统不会替您四舍五入。',
    range: '金额过大。',
    date: '请填写真实的日期。',
    incoterm: '请从列表中选择一个贸易术语。',
    shipping: '请从列表中选择一项。',
    currency: '请选择报价币种。',
  },
  messageTooShort: '请至少写 3 个字符。',
  checkIntro: '发送前请检查。发送后无法修改。',
  checkYourAnswer: '您的留言',
  checkMeeting: '您希望商谈会面或参观。尚未确认任何预约。',
  checkQuote: '您的报价',
  checkNoQuote: '未附报价。',
  acknowledge: '这是我对此请求的个人声明。我了解 Corridra 团队会先审核，其他人才会看到。',
  send: '发送',
  sending: '正在发送',
  notAcknowledged: '请勾选以确认。',
  receiptTitle: '您的回答已记录',
  receiptIntro: '请保留此回执。它是您所发送内容的副本。',
  receiptSource: '已记录为您本人的声明。团队会进行审核。不代表已确认会面、批准或核实。',
  receiptCopy: '复制回执',
  receiptCopied: '已复制',
  receiptDownload: '下载为文本文件',
  receiptHeading: 'Corridra 回执',
  receiptRecordedOn: '记录时间',
  sampleOnly: '(madeup) 示例介绍。没有真实的对外联系。',
  noMailingList: '回复不会使您被加入任何邮件列表。',
  loading: '正在加载您的介绍',
  unavailable: '此私人链接不可用。请打开您收到的完整链接。',
};

export const replyWords: Record<ReplyLanguage, ReplyWords> = { en, zh };

/** The page sets its own language and direction; both languages here read left to right. */
export const replyHtmlLang: Record<ReplyLanguage, { lang: string; dir: 'ltr' | 'rtl' }> = {
  en: { lang: 'en', dir: 'ltr' },
  zh: { lang: 'zh-Hans', dir: 'ltr' },
};

export function fillReply(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-z]+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Missing reply placeholder: ${key}`);
    return value;
  });
}
