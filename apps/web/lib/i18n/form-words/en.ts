// The words of the request form at /plan, in English (Lane 11). English is the source: each value is the text the
// form showed before it moved onto keys, so with the form release off nothing a person sees changes. The other
// languages live in their own files beside this one and are loaded only when the owner has released that language
// in CORRIDRA_LANGUAGES_FORM (docs/product/language-review-record.md).
//
// Not in this file, on purpose: the consent acknowledgements and the notice link names, and every sentence on what
// a person agrees to, who can read or share their information, how long it is kept, or that nothing here is an
// offer. Those stay English in the form itself and are marked English when the rest of the form is translated.
// Data never comes from here either: option values, job keys, country and currency codes, amounts, typed text,
// receipt and status codes, reply bodies and the name Corridra are shown as written.
//
// Three keys are shown only when the form is translated (`form.notice.englishParts`, `form.message.untranslated`,
// `form.message.consentLead`); their English is what a translator works from.
export const formEn = {
  'form.head.label': 'PLAN A MISSION',
  'form.head.title': 'What do you want to do?',
  'form.head.realLead': 'Start with your objective.',
  'form.head.sampleLead': 'A short request is enough. No account needed.',

  'form.notice.realPill': 'YOUR REQUEST',
  'form.notice.realLead': 'Start with the work you need.',
  'form.notice.samplePill': 'Test mode',
  'form.notice.sampleLead': 'Test intake is open. Real customer mission admission is unavailable.',
  'form.notice.sampleUse': 'Use invented details and an email ending in {domain}.',
  'form.notice.sampleReceipt': 'Keep your receipt to read replies.',
  'form.notice.sampleEmail': 'Email delivery is not enabled.',
  'form.notice.englishParts':
    'Sentences about privacy, consent and how long information is kept are in English.',

  'form.pending.title': 'Finish your request.',
  'form.pending.sameDevice':
    'Use this same device and browser. It is submitted to Corridra after that step.',
  'form.pending.open': 'Open your request',
  'form.pending.activate': 'Activate your account',
  'form.pending.signIn': 'Sign in and continue',
  'form.pending.create': 'Create your account',
  'form.pending.codeSignIn': 'Sign in with a code to see your request',
  'form.pending.return': 'Return to the form',

  'form.step.counter': 'STEP {step} OF {total}',
  'form.step.goal': 'Goal',
  'form.step.where': 'Where',
  'form.step.details': 'Details',
  'form.step.results': 'Results',
  'form.step.contact': 'Contact',
  'form.step.journey': 'Request steps',
  'form.step.progress': 'Request progress',
  'form.step.titleGoal': 'What are you trying to achieve?',
  'form.step.titleWhere': 'Where?',
  'form.step.titleDetails': 'What are you offering or looking for?',
  'form.step.titleResults': 'What would make this worthwhile?',
  'form.step.titleContact': 'Where should we respond?',

  'form.summary.title': 'Check this step.',
  'form.summary.body':
    'Review the highlighted fields before continuing. Your entries are still here.',

  'form.goal.legend': 'Mission objective',
  'form.goal.sell': 'Sell in a new market',
  'form.goal.customers': 'Find customers or distributors',
  'form.goal.source': 'Source suppliers',
  'form.goal.trip': 'Make an upcoming business trip more productive',
  'form.goal.mission': 'Run a multi-company mission',
  'form.goal.other': 'Something else',
  'form.goal.job': 'Commercial job',
  'form.goal.choose': 'Choose the job',
  'form.goal.hint': 'Choose a more exact job if you know it.',

  'form.job.buyers': 'Find buyers',
  'form.job.customers': 'Find customers',
  'form.job.distributors': 'Find distributors',
  'form.job.partners': 'Find commercial partners',
  'form.job.sourcing': 'Source products or components',
  'form.job.machinery_procurement': 'Procure machinery',
  'form.job.supplier_evaluation': 'Qualify suppliers',
  'form.job.meetings': 'Arrange commercial meetings',
  'form.job.factory_visits': 'Conduct site visits',
  'form.job.trade_fairs': 'Improve trade-fair yield',
  'form.job.business_trips': 'Plan commercial trip execution',
  'form.job.market_validation': 'Validate a market',
  'form.job.market_entry': 'Enter a market',
  'form.job.export_market_access': 'Develop export access',
  'form.job.delegations': 'Run a multi-company mission',

  'form.where.company': 'Where is the company based?',
  'form.where.chooseCountry': 'Choose a country',
  'form.where.market': 'Which market is involved?',
  'form.where.chooseMarket': 'Choose a market',
  'form.where.eu': 'European Union (trade bloc)',
  'form.where.hint':
    'Company country and target market do not define shipment or meeting location.',
  'form.where.realOther':
    'Tell us what you need. Availability and scope for this direction must be agreed after review.',
  'form.where.sampleOther':
    'No operating offer is announced for this direction. You can still describe an invented test mission.',
  'form.where.when': 'When is the activity needed? (optional)',
  'form.where.attendance': 'Will you be there in person?',
  'form.where.yes': 'Yes',
  'form.where.no': 'No',
  'form.where.undecided': 'Not decided',
  'form.where.from': 'From',
  'form.where.to': 'To',
  'form.where.timezone': 'Visit timezone',

  'form.details.offer': 'Your offer or requirement',
  'form.details.offerExample':
    'Example: We manufacture hotel towels in Bangladesh and want to meet Spanish hospitality distributors buying private-label products.',
  'form.details.offerHint':
    'Start with what you know. You can describe a product photo, an idea, an existing supplier or a price quote. Missing specifications can be clarified later. Image interpretation is not available here.',
  'form.details.technicalPurpose': 'Technical purpose (optional)',
  'form.details.technicalParameters': 'Key technical parameters (optional)',
  'form.details.siteConstraints': 'Site, integration or after-sales constraints (optional)',
  'form.details.specifications': 'Product specifications (optional)',
  'form.details.quantity': 'Required quantity (optional)',
  'form.details.unit': 'Quantity unit (required with quantity)',
  'form.details.supplierPreferences': 'Supplier preferences and constraints (optional)',
  'form.details.targetBuyer': 'Target buyer or distributor (optional)',
  'form.details.readiness': 'Commercial readiness and constraints (optional)',
  'form.details.organiser': 'Delegation organiser (optional)',
  'form.details.participants': 'Participating organisations and individual needs (optional)',
  'form.details.delegationHint': 'Each participant receives an independent mission.',
  'form.details.website': 'Website or catalogue URL (optional)',
  'form.details.websiteHint':
    'A public link helps. We do not open it automatically. Documents can be requested after review.',

  'form.budget.summary': 'Budget context (optional)',
  'form.budget.amount': 'Budget in original currency (optional)',
  'form.budget.currency': 'Original currency',
  'form.budget.none': 'No budget supplied',
  'form.budget.option': '{code} ({places} decimal places)',
  'form.budget.basis': 'Budget basis, such as total equipment budget',
  'form.budget.hint':
    'Enter the amount as quoted, such as {cny} or {bhd}. Use the selected currency’s decimal places. No currency conversion is performed.',

  'form.results.worthwhile': 'What outcome would make the engagement worthwhile? (optional)',
  'form.results.legend': 'Desired outcomes',
  'form.results.meetings': 'Relevant meetings',
  'form.results.buyers': 'Buyers / customers',
  'form.results.distributors': 'Distributor conversations',
  'form.results.supplierVisits': 'Supplier visits',
  'form.results.validation': 'Market validation',
  'form.results.intelligence': 'Local commercial intelligence',
  'form.results.other': 'Something else',
  'form.results.notes': 'Anything specific we should know? (optional)',
  'form.results.contextHint':
    'Tell us where things stand and what help you need next. An existing supplier, approved specification, booked trip or active negotiation can be your starting point.',

  'form.contact.name': 'Name',
  'form.contact.company': 'Company',
  'form.contact.email': 'Work email',
  'form.contact.password': 'Create an account password',
  'form.contact.passwordHint': 'Use at least 14 characters.',
  'form.contact.signedInAs': 'Signed in as {email}.',
  'form.contact.haveAccount': 'Already have an account?',
  'form.contact.signInReturn': 'Sign in and return to this request',
  'form.contact.realHint': 'We review your request and propose next steps.',
  'form.contact.sampleHint':
    'No account needed. We review your request first, then propose next steps. Use your receipt to read replies.',

  'form.action.back': 'Back',
  'form.action.continue': 'Continue',
  'form.action.saving': 'Saving…',
  'form.action.createAccount': 'Create account and continue',
  'form.action.submit': 'Submit mission request',
  'form.action.clearDraft': 'Clear draft',

  'form.receipt.label': 'REQUEST SAVED',
  'form.receipt.title': 'Keep your private receipt.',
  'form.receipt.saveBeforeClosing': 'Save it before closing this tab.',
  'form.receipt.forget': 'Forget this request on this device',
  'form.receipt.code': 'Private receipt code',
  'form.receipt.copy': 'Copy receipt code',
  'form.receipt.another': 'Start another request (save your receipt first)',

  'form.check.realTitle': 'Check an earlier receipt.',
  'form.check.sampleTitle': 'Check a mission request.',
  'form.check.code': 'Receipt code',
  'form.check.submit': 'Check status and replies',
  'form.check.status': 'Status: {status}',
  'form.check.noReply': 'No operator reply yet.',

  'form.side.realLabel': 'Your request',
  'form.side.sampleLabel': 'Your example request',
  'form.side.realHeading': 'YOUR REQUEST',
  'form.side.sampleHeading': 'YOUR EXAMPLE REQUEST',
  'form.side.objective': 'Objective',
  'form.side.country': 'Company country',
  'form.side.market': 'Target market',
  'form.side.budget': 'Original budget',
  'form.side.notChosen': 'Not chosen',
  'form.side.noCurrency': '(currency not chosen)',
  'form.side.notSupplied': 'Not supplied',
  'form.side.draftOnly': 'Draft only.',

  // Messages the form itself sets. Each is the exact English the person sees; `{name}` marks a variable part.
  'form.message.claimFailed': 'Your request could not be submitted. Try again.',
  'form.message.claimUnreadable':
    'The request response could not be read. Open your account to check it.',
  'form.message.navigationMissing':
    'Request navigation is unavailable. Open your account to continue.',
  'form.message.draftLostReal':
    'A saved draft could not be restored. Keep a copy of your request before leaving this tab.',
  'form.message.draftLostSample':
    'A saved draft could not be restored. The form still works; keep a copy of your invented request before leaving this tab.',
  'form.message.draftResumed':
    'A draft from this tab was resumed. Your saved choices take precedence over link suggestions.',
  'form.message.draftNotResumed': 'The earlier draft could not be resumed.',
  'form.message.accountUnchecked': 'Account status could not be checked. Sign in or try again.',
  'form.message.pendingUnchecked': 'Saved request status could not be checked. Try again.',
  'form.message.paused':
    'New requests are paused. Existing requests remain available in your account.',
  'form.message.opening': 'Opening your private request…',
  'form.message.accountFailed': 'Your account could not be checked.',
  'form.message.draftUnsavedReal':
    'This browser could not save the draft. Keep this tab open and copy your request before leaving.',
  'form.message.draftUnsavedSample':
    'This browser could not save the draft. Keep this tab open and copy the invented request before leaving.',
  'form.message.chooseJob': 'Choose the commercial job',
  'form.message.chooseCountry': 'Choose the company country',
  'form.message.chooseMarket': 'Choose the target market',
  'form.message.checkAmount': 'Check the original amount and currency.',
  'form.message.pausedSubmit': 'New requests are paused. Open your account for existing work.',
  'form.message.accountLoading': 'Wait for your account status to finish loading.',
  'form.message.emailMismatch':
    'Use the email address on your signed-in account, or sign out to use a different account.',
  'form.message.passwordShort': 'Choose an account password with at least 14 characters.',
  'form.message.notSaved': 'Your request could not be saved. Your input is still here.',
  'form.message.accountNotCreated':
    'Your account could not be created. Try signing in or creating your account below.',
  'form.message.duplicate': 'This invented example request has already been recorded.',
  'form.message.recorded': 'Your invented example request has been recorded.',
  'form.message.receiptUnsaved':
    'The request was recorded, but this browser could not save its receipt. Copy the private code before leaving.',
  'form.message.unableToSave': 'Unable to save. Your input is still here.',
  'form.message.copied': 'Private receipt code copied.',
  'form.message.copyFailed':
    'Could not copy the code. Select it and copy it before leaving this page.',
  'form.message.unableToCheck': 'Unable to check receipt',
  'form.message.openFailed': 'Your request could not be opened.',
  'form.message.untranslated': 'This message is shown in English.',
  'form.message.consentLead': 'Read the notice and tick the box to continue.',

  // Messages from the server handlers on the request path, word for word.
  'form.message.intakeUnavailable': 'Intake is unavailable',
  'form.message.activationNeeded': 'Finish account activation to submit your request',
  'form.message.checkFields': 'Check the highlighted fields',
  'form.message.changed': 'This brief changed after submission. Start a new brief.',
  'form.message.intakeNotSaved': 'Intake could not be saved. Your input is still here.',
  'form.message.receiptExpired': 'Receipt unavailable or expired',
  'form.message.receiptUnavailable': 'Intake unavailable',
  'form.message.savedExpired': 'Your saved request expired. Start a new request.',
  'form.message.realUnavailable': 'Real request intake is unavailable',
  'form.message.requestUnavailable': 'Request intake is unavailable',
  'form.message.realIntakeUnavailable': 'Real intake is unavailable',
  'form.message.accessDenied': 'Access denied or link unavailable',
  'form.message.checkValues': 'Check the submitted values',
  'form.message.conflict':
    'The request conflicts with the current scope or state. Refresh and review it again.',
  'form.message.notCompleted': 'The request could not be completed. Please try again.',
  'form.message.tooMany': 'Too many requests. Try again in an hour.',
  'form.message.handoffUnavailable': 'Request handoff is unavailable',
  'form.message.workspaceUnavailable': 'Request workspace is unavailable',

  // Messages from the account check on the saved request claim (packages/auth/src/customer-session.ts).
  'form.message.identityUnavailable': 'Customer identity is unavailable',
  'form.message.signInNeeded': 'Sign in to continue',
  'form.message.verifyNeeded': 'Verify your email to continue',
  'form.message.sessionInvalid': 'Customer session is invalid',
  'form.message.accountsUnavailable': 'Customer workspaces are unavailable',
  'form.message.verifiedEmailMissing': 'Verified account email is unavailable',
  'form.message.accountContextInvalid': 'Customer account context is invalid',
  'form.message.accountChanged': 'Your account changed. Reload before continuing.',

  // Messages from the request schemas, including the schema library's own wording.
  'form.message.chooseObjective': 'Choose what you want to do',
  'form.message.enterMarket': 'Enter your target country or market',
  'form.message.max120': 'Use at most 120 characters',
  'form.message.max160': 'Use at most 160 characters',
  'form.message.startDate': 'Enter your visit start date',
  'form.message.endDate': 'Enter your visit end date',
  'form.message.endAfterStart': 'End date must follow the start date',
  'form.message.datesInPerson': 'Only provide visit dates when attending in person',
  'form.message.tooShort': 'Too small: expected string to have >={minimum} characters',
  'form.message.tooLong': 'Too big: expected string to have <={maximum} characters',
  'form.message.timezone': 'Choose a valid timezone',
  'form.message.offerShort': 'Describe your offer or requirement in at least 10 characters',
  'form.message.website': 'Enter a valid http or https website address',
  'form.message.websiteLong': 'Use a shorter website address',
  'form.message.outcome': 'Choose at least one outcome',
  'form.message.name': 'Enter your name',
  'form.message.company': 'Enter your company',
  'form.message.email': 'Invalid email address',
  'form.message.testEmail': 'Use a test address ending in {domain}',
  'form.message.quantity': 'Invalid string: must match pattern /^[1-9][0-9]{0,11}$/',
  'form.message.unit': 'Quantity needs a unit',
  'form.message.budget': 'Budget needs amount, original currency and quantity basis',

  // Messages from the amount reader.
  'form.message.currency': 'Choose the original currency.',
  'form.message.amountFormat':
    'Enter an original nonnegative amount using a period for the decimal separator.',
  'form.message.decimals':
    '{code} permits at most {places} decimal places. No rounding is performed.',
  'form.message.amountRange': 'The amount exceeds the supported range.',

  // The browser's own words when there is no connection (Chromium, Firefox, Safari).
  'form.message.offline': 'Failed to fetch',
  'form.message.offlineFirefox': 'NetworkError when attempting to fetch resource.',
  'form.message.offlineSafari': 'Load failed',
} as const;

export type FormKey = keyof typeof formEn;
/** Every language's form words: the type checker holds each file to exactly the English keys. */
export type FormCatalog = Record<FormKey, string>;
