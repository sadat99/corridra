// Words of the public programme page and applications (ADR-080). English is the source. Every other catalogue
// carries these English words until a native reviewer is recorded for that language, so no unreviewed translation is
// shown (the same rule as the Trip view words). Keys are stable: a translation replaces a value, never a key.
//
// Terms held apart on purpose (do not merge them in any language):
//   Programme     the organiser's delegation as a whole. Not a Mission (one company's own piece of work).
//   Application   a person asking to take part. Not a Request (sent to the Corridra team) and not a registration.
//   Invited       the organiser's answer to an application. Not an Introduction (to a counterparty).
//   Joined        registered in the programme. Not a confirmed attendance and not a payment.
//   Planned       the organiser intends it. Confirmed is the organiser's own statement that it is fixed.
//                 Neither means Verified or Reviewed, which are Corridra's evidence words.
export const programmePagesWords = {
  // The public page
  'pp.public.eyebrow': 'BUSINESS DELEGATION',
  'pp.public.eyebrowSample': 'BUSINESS DELEGATION · SAMPLE',
  'pp.public.metaTitle': 'Business delegation | Corridra',
  'pp.public.sampleNote':
    'This is a sample page. The programme and the organiser on it are examples, not real offers.',
  'pp.public.fact.organiser': 'Organised by',
  'pp.public.fact.where': 'Where',
  'pp.public.fact.when': 'When',
  'pp.public.fact.focus': 'Focus',
  'pp.public.fact.places': 'Places',
  'pp.public.fact.fee': 'Fee',
  'pp.public.placesPlanned': '{count} planned',
  'pp.public.notStated': 'Not stated yet',
  'pp.public.apply.title': 'Apply for a place',
  'pp.public.apply.closedTitle': 'Applications are closed',
  'pp.public.apply.closes': 'Applications close',
  'pp.public.apply.closedOn': 'Applications closed',
  'pp.public.dateUtc': '{date} (UTC)',
  'pp.public.apply.text':
    'You apply with a free Corridra account. Applying is not a booking and no fee is taken on this page.',
  'pp.public.apply.closedText': 'The organiser may open applications again.',
  'pp.public.next.title': 'What happens next',
  'pp.public.next.1': 'You send a short application.',
  'pp.public.next.2': 'The organiser reads it and answers you.',
  'pp.public.next.3':
    'If you are invited, you join and read the terms and the fee before you accept them.',
  'pp.public.plan.count': '{confirmed} confirmed, {planned} planned',
  'pp.public.apply.previewNote': 'The Apply button appears here on the published page.',
  'pp.public.apply.action': 'Apply for a Place',
  'pp.public.who.title': 'Who it is for',
  'pp.public.who.takePart': 'To take part',
  'pp.public.plan.title': 'The programme',
  'pp.public.plan.planned': 'Planned',
  'pp.public.plan.confirmed': 'Confirmed',
  'pp.public.plan.note':
    "Planned means the organiser intends it and has not confirmed it. Confirmed is the organiser's own statement.",
  'pp.public.fee.title': 'What the fee covers',
  'pp.public.fee.included': 'Included',
  'pp.public.fee.excluded': 'Not included',
  'pp.public.responsible.title': 'Who is responsible',
  'pp.public.responsible.text':
    '{organiser} runs this programme and is responsible for it, its fee and what it includes. Everything on this page is stated by the organiser. Corridra provides the tools the organiser uses. Corridra is not the travel operator and has not checked these details.',
  // Sharing, started by the person
  'pp.share.title': 'Share this page',
  'pp.share.copy': 'Copy Link',
  'pp.share.whatsapp': 'Share on WhatsApp',
  'pp.share.facebook': 'Share on Facebook',
  'pp.share.copied': 'Link copied.',
  'pp.share.copyManually': 'Copy this link: {url}',
  // The share kit (ADR-084 S1): all of it is started by the person pressing, and built from the published words only
  'pp.kit.flyer': 'Open Flyer',
  'pp.kit.calendar': 'Add to Calendar',
  'pp.kit.qr.show': 'Show QR Code',
  'pp.kit.qr.hide': 'Hide QR Code',
  'pp.kit.qr.label': 'QR code that opens {title}',
  'pp.kit.qr.hint': 'Scan with a phone camera to open this page.',
  'pp.kit.attribution': 'Page made with Corridra Programmes',
  'pp.flyer.title': 'Flyer for {title}',
  'pp.flyer.print': 'Print Flyer',
  'pp.flyer.back': 'Back to the Page',
  'pp.flyer.scan': 'Scan to read the page and apply.',
  'pp.flyer.addressLabel': 'Page address',
  'pp.flyer.stated':
    'Everything on this flyer is stated by the organiser. Corridra has not checked these details and is not the travel operator.',
  'pp.flyer.sample':
    'Sample. The programme and the organiser on this flyer are examples, not real offers.',
  'pp.flyer.feeStated': 'Fee as the organiser states it',
  // The line on the account pages for a visitor who chose a programme before signing in
  'pp.notice.text': 'You chose to apply to {title}. Your application has not been sent yet.',
  'pp.notice.continue': 'Continue Your Application',
  'pp.notice.dismiss': 'Not Now',
  // The delegate's objective, carried from the application into a private request and, by choice, to the organisers.
  'pp.path.heading': 'Your objective for this programme',
  'pp.path.lead': 'Said once. It goes with you from here.',
  'pp.path.statement.label': 'What you wrote when you applied',
  'pp.path.statement.none':
    'You joined with an invitation code, so there are no application words to carry. Your request starts empty.',
  'pp.path.state.done': 'Done',
  'pp.path.state.next': 'Next',
  'pp.path.state.later': 'Later',
  'pp.path.step.request': 'Start your private request',
  'pp.path.step.request.text': 'Only you and the Corridra team see it, not the organisers.',
  'pp.path.step.request.carried': 'Your words are already in it. You review it before it is sent.',
  'pp.path.step.request.prefill':
    'The organisers shared the destination and dates: {market}, {start} to {end} ({zone}). They are added to your draft. You can change them before it is sent.',
  'pp.path.step.request.have': 'You have a private request.',
  'pp.path.step.request.another': 'Start Another Request',
  'pp.path.step.request.elsewhere': 'Start a Request From Your Workspaces',
  'pp.path.workspace': 'Workspace for the request',
  'pp.path.workspace.new': 'Name for your company workspace',
  'pp.path.workspace.new.hint':
    'A private space for your own company’s requests. The organisers cannot see it.',
  'pp.path.find.suppliers': 'Find Suppliers or Products',
  'pp.path.find.buyers': 'Find Buyers or Partners',
  'pp.path.find.other': 'Something Else',
  'pp.path.starting': 'Preparing your request…',
  'pp.path.error.name': 'Enter a workspace name of at least two characters.',
  'pp.path.error.name.sample':
    'Start the sample workspace name with Synthetic and use at least 11 characters.',
  'pp.path.error.workspace': 'The workspace could not be created. Nothing was sent. Try again.',
  'pp.path.error.start': 'Your request could not be prepared. Nothing was sent. Try again.',
  'pp.path.step.share': 'Share one sentence with the organisers',
  'pp.path.step.share.text':
    'They see only the sentence you approve, to plan visits around it. Your request stays private.',
  'pp.path.step.share.needs': 'Available once you have sent a private request.',
  'pp.path.share': 'Share My Objective',
  'pp.path.step.share.done':
    'Shared with the organisers. Change or withdraw it under Manage My Shared Objectives.',
  'pp.path.step.results': 'Afterwards, record what happened',
  'pp.path.step.results.text': 'Use Feedback and Results. You choose what the organisers see.',
  'pp.path.return.text': 'This request started from {programme}.',
  'pp.path.return.link': 'Share Its Objective With the Organisers',
  // Application states
  'pp.status.SUBMITTED': 'Waiting for the organiser',
  'pp.status.WAITLISTED': 'On the waiting list',
  'pp.status.DECLINED': 'Declined',
  'pp.status.INVITED': 'Invited',
  'pp.status.INVITATION_EXPIRED': 'Invitation expired',
  'pp.status.JOINED': 'Joined',
  'pp.status.REGISTRATION_ENDED': 'No longer registered',
  'pp.status.WITHDRAWN': 'Withdrawn',
  // Page states, as the organiser reads them
  'pp.state.NONE': 'Not published',
  'pp.state.OPEN': 'Published and taking applications',
  'pp.state.CLOSED': 'Published, applications closed',
  'pp.state.ENDED': 'Closed for more than 30 days: the page is no longer shown',
  'pp.state.WITHDRAWN': 'Taken down',
  'pp.state.PAUSED': 'Not shown while the programme or workspace is archived',
  // Named refusals: each says what the person can do next
  'pp.refusal.PROGRAMME_PUBLICATION_CHANGED':
    'This page changed since you opened it. Nothing was saved. Reload to see the latest version.',
  'pp.refusal.PROGRAMME_PUBLICATION_PAUSED':
    'This programme or its workspace is archived. Restore it before publishing, inviting or joining.',
  'pp.refusal.PROGRAMME_SCHEDULE_ALREADY_SET':
    'These days are already set for this version of the page. Publish a new version to change them.',
  'pp.refusal.PROGRAMME_PUBLICATION_RATE_LIMITED':
    'This page was published many times in the last hour. Wait a while, then publish again.',
  'pp.refusal.PROGRAMME_APPLICATIONS_CLOSED':
    'This programme is not taking applications right now.',
  'pp.refusal.PROGRAMME_ALREADY_REGISTERED': 'This person is already registered in this programme.',
  'pp.refusal.PROGRAMME_APPLICATION_CHANGED':
    'This application changed since you opened it. Nothing was saved. Reload to see the latest.',
  'pp.refusal.PROGRAMME_APPLICATION_WITHDRAWN': 'The applicant withdrew this application.',
  'pp.refusal.PROGRAMME_APPLICATION_JOINED':
    'This applicant has already joined. Manage the registration under Participants.',
  'pp.refusal.PROGRAMME_APPLICATION_ALREADY_INVITED':
    'This applicant already has an invitation they can use.',
  'pp.refusal.PROGRAMME_APPLICATION_NOT_INVITED':
    'The organiser has not invited this application yet.',
  'pp.refusal.PROGRAMME_INVITATION_EXPIRED':
    'This invitation has expired. Ask the organiser to invite you again.',
  'pp.refusal.PROGRAMME_APPLICATION_LIMIT':
    'No more applications can be made to this programme from this account.',
  'pp.refusal.PROGRAMME_APPLICATION_RATE_LIMITED':
    'You made many applications in the last hour. Wait a while, then try again.',
  // Failures of a request
  'pp.error.offline': 'No connection. What you typed is kept. Try again when you are online.',
  'pp.error.denied': 'Your account or workspace access changed. Reload and sign in again.',
  'pp.error.invalid': 'Some details are not valid. Check the wording and try again.',
  'pp.error.tooMany': 'Too many requests. Wait a minute and try again.',
  'pp.error.unavailable': 'Programme pages are unavailable right now.',
  'pp.error.notSaved': 'It could not be saved. What you typed is kept. Try again.',
  'pp.tryAgain': 'Try Again',
  'pp.cancel': 'Cancel',
  // The organiser's panel
  'pp.org.loading': 'Loading the public page…',
  'pp.org.unavailable': 'Public programme pages are not available yet.',
  'pp.org.denied': 'Only owners and admins of this workspace can manage the public page.',
  'pp.org.failed': 'The public page could not be loaded. Nothing was changed.',
  'pp.org.label': 'Public page:',
  'pp.org.until': ' until {date} (UTC)',
  'pp.org.version': ' · version {version}',
  'pp.org.intro':
    'Publish a page to let companies read about this programme and apply. Only the words you write for the page become public. Participants, prices and private requests stay private.',
  'pp.org.write': 'Write the Public Page',
  'pp.org.edit': 'Edit the Page',
  'pp.org.editAgain': 'Edit and Publish Again',
  'pp.org.takeDown': 'Take the Page Down',
  'pp.org.takeDownConfirm':
    'Take the page down? The address stops working until you publish again.',
  'pp.org.published': 'Published. The page is public at its address below.',
  'pp.org.takenDown': 'The page is taken down. Applications already made are kept.',
  'pp.org.applications.label': 'Applications',
  'pp.org.applications.count': 'Applications: {awaiting} waiting for your answer, {total} in all',
  'pp.org.applications.empty':
    'No applications yet. Share the page address with the companies you want to reach.',
  'pp.org.applications.more': 'Show More Applications',
  'pp.org.applications.moreFailed': 'More applications could not be loaded. Try again.',
  'pp.org.row.applied': 'Applied {date}. Stated by the applicant, not checked.',
  'pp.org.row.invitationUntil': ' Invitation can be used until {date}.',
  'pp.org.row.yourNote': ' Your note: {note}',
  'pp.org.row.joined':
    'Registered. Terms, places and fees for this participant are under Participants and Terms.',
  'pp.org.invite': 'Invite to Join',
  'pp.org.inviteAgain': 'Invite Again',
  'pp.org.waitlist': 'Put on Waiting List',
  'pp.org.decline': 'Decline',
  'pp.org.declineConfirm': 'Confirm Decline',
  'pp.org.declineReason': 'Reason the applicant will read',
  'pp.org.declineReasonNeeded':
    'Write a short reason the applicant will read (10 to 500 characters).',
  // The editor: six steps of at most three fields
  'pp.edit.step': 'Step {step} of {total}: {name}',
  'pp.edit.progress': 'Progress through the page',
  'pp.edit.progressValue': '{step} of {total}',
  'pp.edit.step.basics': 'Basics',
  'pp.edit.step.where': 'Where and when',
  'pp.edit.step.who': 'Who it is for',
  'pp.edit.step.programme': 'The programme',
  'pp.edit.step.fee': 'Fee',
  'pp.edit.step.publish': 'Check and publish',
  'pp.edit.title.label': 'Title',
  'pp.edit.title.hint': 'What the delegation is called in public.',
  'pp.edit.organiser.label': 'Organised by',
  'pp.edit.organiser.hint': 'Your organisation or your own name.',
  'pp.edit.summary.label': 'What it is for',
  'pp.edit.summary.hint': 'One or two sentences. One paragraph.',
  'pp.edit.destination.label': 'Where',
  'pp.edit.destination.hint': 'City and country, for example "Guangzhou, China".',
  'pp.edit.dates.label': 'When',
  'pp.edit.dates.hint': 'If the dates are not fixed yet, say so.',
  'pp.edit.schedule.starts': 'First day (optional)',
  'pp.edit.schedule.ends': 'Last day (optional)',
  'pp.edit.schedule.hint':
    'Both days, or neither. They make the calendar file on the public page. They are not shown on the page itself.',
  'pp.edit.problem.schedule':
    'Give both days, with the last day on or after the first, no more than a year apart. Or leave both empty.',
  'pp.edit.schedule.failed':
    'The page is published, but the calendar days could not be saved. Edit the page to add them again.',
  'pp.edit.focus.label': 'Industry or business focus',
  'pp.edit.focus.hint': 'For example "Agricultural machinery".',
  'pp.edit.audience.label': 'Who should apply',
  'pp.edit.audience.hint': 'The kind of company and person.',
  'pp.edit.eligibility.label': 'What a company needs to take part',
  'pp.edit.eligibility.hint': 'Your own conditions.',
  'pp.edit.capacity.label': 'Places (optional)',
  'pp.edit.capacity.hint': 'How many companies you plan to take.',
  'pp.edit.activities.label': 'Visits and meetings (optional)',
  'pp.edit.activities.hint':
    'One per line, up to 12. Each is shown as Planned unless you mark it confirmed below.',
  'pp.edit.confirmed.legend': 'Mark only what is already confirmed',
  'pp.edit.fee.label': 'Fee (optional)',
  'pp.edit.fee.hint': 'The amount, the currency and who it is paid to.',
  'pp.edit.included.label': 'Included (optional)',
  'pp.edit.excluded.label': 'Not included (optional)',
  'pp.edit.list.hint': 'One per line, up to 8.',
  'pp.edit.closes.label': 'Applications close on',
  'pp.edit.closes.hint': 'End of that day, UTC. You can reopen later.',
  'pp.edit.preview': 'Preview: this is exactly what the public will read',
  'pp.edit.agree':
    'I checked this page. It contains no private contact, price list or participant detail, and I am allowed to publish it.',
  'pp.edit.agreeNeeded': 'Tick the box to confirm you checked the page before it goes public.',
  'pp.edit.continue': 'Continue',
  'pp.edit.back': 'Back',
  'pp.edit.publish': 'Publish the Page',
  'pp.edit.publishing': 'Publishing…',
  'pp.edit.close': 'Close and Keep Draft',
  'pp.edit.problem.title': 'Write a title of 3 to 160 characters.',
  'pp.edit.problem.organiser': 'Write the name of the organiser.',
  'pp.edit.problem.sample':
    'This is a sample workspace. Start the title and the organiser name with "Synthetic ".',
  'pp.edit.problem.summary':
    'Say in one or two sentences what the programme is for (10 to 1200 characters).',
  'pp.edit.problem.destination': 'Write where the programme goes.',
  'pp.edit.problem.dates':
    'Write the dates. If they are not fixed, say so, for example "April 2027, to be confirmed".',
  'pp.edit.problem.focus': 'Write the industry or business focus.',
  'pp.edit.problem.audience': 'Say who should apply (10 to 600 characters).',
  'pp.edit.problem.eligibility': 'Say what a company needs to take part (10 to 600 characters).',
  'pp.edit.problem.capacity': 'Places must be a whole number from 1 to 1000, or left empty.',
  'pp.edit.problem.activitiesCount': 'List at most 12 visits or meetings.',
  'pp.edit.problem.activityLength': 'Each line must be 3 to 160 characters.',
  'pp.edit.problem.activitySame': 'Two lines are the same. Change one of them.',
  'pp.edit.problem.fee': 'The fee line is too long.',
  'pp.edit.problem.listCount': 'List at most 8 lines in each box.',
  'pp.edit.problem.listLength': 'Each line must be 2 to 160 characters.',
  'pp.edit.problem.closes': 'Choose a closing date from tomorrow up to 179 days from now.',
  // A person's own applications
  'pp.apply.heading': 'Your applications',
  'pp.apply.gone':
    'That programme page is not available. It may have been taken down or its address may be wrong. Ask the organiser for the current link.',
  'pp.apply.to': 'Apply to {title}',
  'pp.apply.organisedBy': 'Organised by {organiser}.',
  'pp.apply.name.label': 'Your company name, or your own name',
  'pp.apply.name.hint': 'The organiser sees this name.',
  'pp.apply.statement.label': 'What you want from this programme',
  'pp.apply.statement.hint':
    'For example what you want to buy or sell and who you want to meet. One paragraph.',
  'pp.apply.consent':
    'Send this name and statement to the organiser. They do not see my private requests, contacts or prices. Applying is not a booking.',
  'pp.apply.privacy':
    'Corridra stores your application. The owners and admins of the organiser can read it, and so can the Corridra team, who cannot change or answer it. Until you join, you can withdraw it, and it stays on record as withdrawn.',
  'pp.apply.privacyLink': 'How Corridra Handles Your Data',
  'pp.apply.send': 'Send Application',
  'pp.apply.sending': 'Sending…',
  'pp.apply.closed': 'This programme is not taking applications right now.',
  'pp.apply.sent':
    'Your application was sent to the organiser. Their answer will appear here. Nothing is booked or charged yet.',
  'pp.apply.loading': 'Loading your applications…',
  'pp.apply.failed': 'Your applications could not be loaded. Nothing was changed.',
  'pp.apply.empty':
    'You have not applied to a programme. An organiser can send you the link to their programme page.',
  'pp.apply.problem.name': 'Write your company name or your own name (up to 120 characters).',
  'pp.apply.problem.statement': 'Say what you want from this programme (10 to 1000 characters).',
  'pp.apply.problem.sample':
    'This is a sample programme. Start the name and the statement with "Synthetic " and use no real details.',
  'pp.apply.problem.paragraph': 'Write the statement as one paragraph.',
  'pp.apply.problem.consent': 'Tick the box to send your application to the organiser.',
  'pp.apply.row.fallbackTitle': 'Programme',
  'pp.apply.row.applied': 'Applied {date} as {name}.',
  'pp.apply.row.submitted': ' The organiser has not answered yet.',
  'pp.apply.row.waitlisted': ' The organiser put you on the waiting list. This is not a place.',
  'pp.apply.row.invited': ' You are invited. Join by {date} (UTC).',
  'pp.apply.row.expired':
    ' Your invitation expired before you joined. Ask the organiser to invite you again.',
  'pp.apply.row.joined': ' You are registered. See your registration below.',
  'pp.apply.row.note': 'From the organiser: {note}',
  'pp.apply.row.open': 'Open the Programme Page',
  'pp.apply.join': 'Join the Programme',
  'pp.apply.joinConsent':
    "Register me in this programme under the name {name}. The organiser's terms, places and fees come next and are shown before you accept them.",
  'pp.apply.joinConfirm': 'Confirm and Join',
  'pp.apply.joinNeeded': 'Tick the box to join the programme.',
  'pp.apply.withdraw': 'Withdraw Application',
  'pp.apply.withdrawConfirm': 'Withdraw this application? The organiser will see it as withdrawn.',
  // The guided first run (ADR-084 S0): three steps of at most three fields, ending on Publish. It asks for the
  // editor's own lines and sends the existing create, template and publish commands.
  'pp.first.title': 'Set up your delegation',
  'pp.first.lead':
    'Four short steps. Your answers stay in this browser until you press Publish. Nothing is saved to your workspace or made public before that.',
  'pp.first.step.name': 'Name and place',
  'pp.first.step.dates': 'Dates and people',
  'pp.first.step.fee': 'Fee and places',
  'pp.first.step.review': 'Review and publish',
  'pp.first.review.edit': 'Edit',
  'pp.first.review.editName': 'Edit {name}',
  'pp.first.name.label': 'Programme name',
  'pp.first.template.label': 'Start from a template (optional)',
  'pp.first.template.none': 'No template',
  'pp.first.template.hint':
    'A template adds its tasks and planned costs to the new programme. It never adds people, fees or payments.',
  'pp.first.dates.hint': 'For example "12 to 16 March 2027".',
  'pp.first.dates.unsure': 'I am not sure yet',
  'pp.first.dates.unsureValue': 'Dates to be confirmed',
  'pp.first.more': 'More Page Lines',
  'pp.first.more.note':
    'Your page also shows these lines. Change any of them now, or later from the programme.',
  'pp.first.preview.title': 'Your public page so far',
  'pp.first.preview.note':
    'This is what the public will read after you publish. It updates as you type.',
  'pp.first.preview.open': 'Preview Your Page',
  'pp.first.preview.empty': 'Not written yet',
  'pp.first.preview.name': 'Your programme name',
  'pp.first.ack.planning':
    'I confirm these planning details. Arrangements and costs need separate agreement.',
  'pp.first.ack.sample': 'I am using made-up information for sample planning only.',
  'pp.first.ackNeeded': 'Tick both boxes before you publish.',
  'pp.first.startAgain': 'Start Again',
  'pp.first.startAgainConfirm': 'Clear everything typed here and start again?',
  'pp.first.restoring': 'Checking for a draft in this browser…',
  'pp.first.busy.create': 'Saving the programme…',
  'pp.first.busy.template': 'Adding the template…',
  'pp.first.error.create':
    'The programme could not be saved. What you typed is kept. Press Publish to try again.',
  'pp.first.error.conflict':
    'The workspace changed while this was being saved. Reload the page, then press Publish again. What you typed is kept.',
  'pp.first.error.template':
    'Your programme is saved, but the template could not be added. Press Publish to try again, or choose No template in step 1.',
  'pp.first.error.page':
    'Your programme is saved, but its page could not be opened. Press Publish to try again.',
  'pp.first.saved.note':
    'Your programme is saved in this workspace. Its page is not public yet. Press Publish to finish.',
  'pp.first.published':
    'Published. Your programme is saved and its page is public. Copy the address below to share it.',
  'pp.first.plain': 'Create Without a Public Page',
} as const;
