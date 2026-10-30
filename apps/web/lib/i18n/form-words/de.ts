import type { FormCatalog } from './en';

// German request form words. Agent draft, not reviewed: shown only where the owner has released German in
// CORRIDRA_LANGUAGES_FORM after a recorded review (docs/product/language-review-record.md). Formal address (Sie).
export const words: FormCatalog = {
  'form.head.label': 'Eine Mission planen',
  'form.head.title': 'Was möchten Sie tun?',
  'form.head.realLead': 'Beginnen Sie mit Ihrem Ziel.',
  'form.head.sampleLead': 'Eine kurze Anfrage genügt. Sie brauchen kein Konto.',

  'form.notice.realPill': 'Ihre Anfrage',
  'form.notice.realLead': 'Beginnen Sie mit der Arbeit, die Sie brauchen.',
  'form.notice.samplePill': 'Beispielmodus',
  'form.notice.sampleLead':
    'Beispielanfragen sind möglich. Echte Kundenmissionen werden nicht angenommen.',
  'form.notice.sampleUse':
    'Verwenden Sie erfundene Angaben und eine E-Mail-Adresse, die auf {domain} endet.',
  'form.notice.sampleReceipt': 'Bewahren Sie Ihren Beleg auf, um Antworten zu lesen.',
  'form.notice.sampleEmail': 'Der E-Mail-Versand ist nicht eingeschaltet.',
  'form.notice.englishParts':
    'Sätze zu Datenschutz, Einwilligung und Speicherdauer stehen auf Englisch.',

  'form.pending.title': 'Schließen Sie Ihre Anfrage ab.',
  'form.pending.sameDevice':
    'Verwenden Sie dasselbe Gerät und denselben Browser, um Ihr Konto zu aktivieren und sich anzumelden. Erst danach wird die Anfrage an Corridra gesendet.',
  'form.pending.open': 'Anfrage öffnen',
  'form.pending.activate': 'Konto aktivieren',
  'form.pending.signIn': 'Anmelden und weiter',
  'form.pending.create': 'Konto erstellen',
  'form.pending.codeSignIn': 'Mit einem Code anmelden und die Anfrage sehen',
  'form.pending.return': 'Zurück zum Formular',

  'form.step.counter': 'Schritt {step} von {total}',
  'form.step.goal': 'Ziel',
  'form.step.where': 'Ort',
  'form.step.details': 'Details',
  'form.step.results': 'Ergebnis',
  'form.step.contact': 'Kontakt',
  'form.step.journey': 'Schritte der Anfrage',
  'form.step.progress': 'Fortschritt der Anfrage',
  'form.step.titleGoal': 'Was möchten Sie erreichen?',
  'form.step.titleWhere': 'Wo?',
  'form.step.titleDetails': 'Was bieten Sie an oder was suchen Sie?',
  'form.step.titleResults': 'Welches Ergebnis wäre für Sie wertvoll?',
  'form.step.titleContact': 'Wohin sollen wir antworten?',

  'form.summary.title': 'Bitte prüfen Sie diesen Schritt.',
  'form.summary.body':
    'Prüfen Sie die markierten Felder, bevor Sie weitergehen. Ihre Angaben bleiben erhalten.',

  'form.goal.legend': 'Ziel der Mission',
  'form.goal.sell': 'In einem neuen Markt verkaufen',
  'form.goal.customers': 'Kunden oder Vertriebspartner finden',
  'form.goal.source': 'Lieferanten finden',
  'form.goal.trip': 'Eine geplante Geschäftsreise ergiebiger machen',
  'form.goal.mission': 'Eine Mission mit mehreren Unternehmen durchführen',
  'form.goal.other': 'Etwas anderes',
  'form.goal.job': 'Geschäftliche Aufgabe',
  'form.goal.choose': 'Aufgabe wählen',
  'form.goal.hint': 'Wählen Sie eine genauere Aufgabe, wenn Sie sie kennen.',

  'form.job.buyers': 'Käufer finden',
  'form.job.customers': 'Kunden finden',
  'form.job.distributors': 'Vertriebspartner finden',
  'form.job.partners': 'Geschäftspartner finden',
  'form.job.sourcing': 'Produkte oder Bauteile beschaffen',
  'form.job.machinery_procurement': 'Maschinen beschaffen',
  'form.job.supplier_evaluation': 'Lieferanten prüfen',
  'form.job.meetings': 'Geschäftstermine vereinbaren',
  'form.job.factory_visits': 'Standorte besuchen',
  'form.job.trade_fairs': 'Messebesuche ergiebiger machen',
  'form.job.business_trips': 'Geschäftsreisen planen und durchführen',
  'form.job.market_validation': 'Einen Markt prüfen',
  'form.job.market_entry': 'In einen Markt eintreten',
  'form.job.export_market_access': 'Exportzugang aufbauen',
  'form.job.delegations': 'Eine Mission mit mehreren Unternehmen durchführen',

  'form.where.company': 'Wo hat das Unternehmen seinen Sitz?',
  'form.where.chooseCountry': 'Land wählen',
  'form.where.market': 'Um welchen Markt geht es?',
  'form.where.chooseMarket': 'Markt wählen',
  'form.where.eu': 'Europäische Union (Handelsblock)',
  'form.where.hint':
    'Firmenland und Zielmarkt legen weder den Versandort noch den Ort von Treffen fest.',
  'form.where.realOther':
    'Beschreiben Sie, was Sie brauchen. Verfügbarkeit und Umfang für diese Richtung müssen nach der Prüfung vereinbart werden.',
  'form.where.sampleOther':
    'Für diese Richtung ist kein laufendes Angebot angekündigt. Sie können trotzdem eine erfundene Beispielmission beschreiben.',
  'form.where.when': 'Wann wird die Tätigkeit gebraucht? (optional)',
  'form.where.attendance': 'Sind Sie persönlich vor Ort?',
  'form.where.yes': 'Ja',
  'form.where.no': 'Nein',
  'form.where.undecided': 'Nicht entschieden',
  'form.where.from': 'Von',
  'form.where.to': 'Bis',
  'form.where.timezone': 'Zeitzone des Besuchs',

  'form.details.offer': 'Ihr Angebot oder Bedarf',
  'form.details.offerExample':
    'Beispiel: Wir stellen in Bangladesch Hotelhandtücher her und möchten spanische Hotelgroßhändler treffen, die Eigenmarken kaufen.',
  'form.details.offerHint':
    'Beginnen Sie mit dem, was Sie wissen. Sie können ein Produktfoto, eine Idee, einen bestehenden Lieferanten oder ein Preisangebot beschreiben. Fehlende Angaben lassen sich später klären. Eine Bildauswertung ist hier nicht verfügbar.',
  'form.details.technicalPurpose': 'Technischer Zweck (optional)',
  'form.details.technicalParameters': 'Wichtige technische Werte (optional)',
  'form.details.siteConstraints': 'Vorgaben zu Standort, Einbindung oder Kundendienst (optional)',
  'form.details.specifications': 'Produktangaben (optional)',
  'form.details.quantity': 'Benötigte Menge (optional)',
  'form.details.unit': 'Mengeneinheit (nötig bei einer Menge)',
  'form.details.supplierPreferences': 'Wünsche und Vorgaben zu Lieferanten (optional)',
  'form.details.targetBuyer': 'Gesuchter Käufer oder Vertriebspartner (optional)',
  'form.details.readiness': 'Geschäftlicher Stand und Vorgaben (optional)',
  'form.details.organiser': 'Organisator der Delegation (optional)',
  'form.details.participants': 'Teilnehmende Organisationen und ihr Bedarf (optional)',
  'form.details.delegationHint': 'Jede teilnehmende Organisation erhält eine eigene Mission.',
  'form.details.website': 'Website oder Katalog-URL (optional)',
  'form.details.websiteHint':
    'Ein öffentlicher Link hilft. Wir öffnen ihn nicht automatisch. Unterlagen können nach der Prüfung angefordert werden.',

  'form.budget.summary': 'Angaben zum Budget (optional)',
  'form.budget.amount': 'Budget in der Originalwährung (optional)',
  'form.budget.currency': 'Originalwährung',
  'form.budget.none': 'Kein Budget angegeben',
  'form.budget.option': '{code} ({places} Nachkommastellen)',
  'form.budget.basis': 'Grundlage des Budgets, zum Beispiel Gesamtbudget für Anlagen',
  'form.budget.hint':
    'Geben Sie den Betrag wie angeboten ein, etwa {cny} oder {bhd}, mit einem Punkt als Dezimalzeichen. Nutzen Sie die Nachkommastellen der gewählten Währung. Es wird keine Währung umgerechnet.',

  'form.results.worthwhile': 'Welches Ergebnis würde sich für Sie lohnen? (optional)',
  'form.results.legend': 'Gewünschte Ergebnisse',
  'form.results.meetings': 'Passende Termine',
  'form.results.buyers': 'Käufer / Kunden',
  'form.results.distributors': 'Gespräche mit Vertriebspartnern',
  'form.results.supplierVisits': 'Besuche bei Lieferanten',
  'form.results.validation': 'Prüfung des Markts',
  'form.results.intelligence': 'Wissen über den Markt vor Ort',
  'form.results.other': 'Etwas anderes',
  'form.results.notes': 'Gibt es etwas, das wir wissen sollten? (optional)',
  'form.results.contextHint':
    'Beschreiben Sie den aktuellen Stand und welche Hilfe Sie als Nächstes brauchen. Ein bestehender Lieferant, eine freigegebene Spezifikation, eine gebuchte Reise oder laufende Verhandlungen können Ihr Ausgangspunkt sein.',

  'form.contact.name': 'Name',
  'form.contact.company': 'Unternehmen',
  'form.contact.email': 'Geschäftliche E-Mail',
  'form.contact.password': 'Passwort für das Konto festlegen',
  'form.contact.passwordHint': 'Verwenden Sie mindestens 14 Zeichen.',
  'form.contact.signedInAs': 'Angemeldet als {email}.',
  'form.contact.haveAccount': 'Haben Sie schon ein Konto?',
  'form.contact.signInReturn': 'Anmelden und zu dieser Anfrage zurückkehren',
  'form.contact.realHint': 'Wir prüfen Ihre Anfrage und schlagen die nächsten Schritte vor.',
  'form.contact.sampleHint':
    'Sie brauchen kein Konto. Wir prüfen zuerst Ihre Anfrage und schlagen dann die nächsten Schritte vor. Mit Ihrem Beleg lesen Sie die Antworten.',

  'form.action.back': 'Zurück',
  'form.action.continue': 'Weiter',
  'form.action.saving': 'Wird gespeichert…',
  'form.action.createAccount': 'Konto erstellen und weiter',
  'form.action.submit': 'Anfrage senden',
  'form.action.clearDraft': 'Entwurf löschen',

  'form.receipt.label': 'Anfrage gespeichert',
  'form.receipt.title': 'Bewahren Sie Ihren privaten Beleg auf.',
  'form.receipt.saveBeforeClosing': 'Speichern Sie ihn, bevor Sie diesen Tab schließen.',
  'form.receipt.forget': 'Anfrage auf diesem Gerät vergessen',
  'form.receipt.code': 'Privater Belegcode',
  'form.receipt.copy': 'Belegcode kopieren',
  'form.receipt.another': 'Neue Anfrage beginnen (zuerst den Beleg sichern)',

  'form.check.realTitle': 'Einen früheren Beleg prüfen.',
  'form.check.sampleTitle': 'Anfrage zu einer Mission prüfen.',
  'form.check.code': 'Belegcode',
  'form.check.submit': 'Status und Antworten prüfen',
  'form.check.status': 'Status: {status}',
  'form.check.noReply': 'Noch keine Antwort vom Corridra-Team.',

  'form.side.realLabel': 'Ihre Anfrage',
  'form.side.sampleLabel': 'Ihre Beispielanfrage',
  'form.side.realHeading': 'Ihre Anfrage',
  'form.side.sampleHeading': 'Ihre Beispielanfrage',
  'form.side.objective': 'Ziel',
  'form.side.country': 'Firmenland',
  'form.side.market': 'Zielmarkt',
  'form.side.budget': 'Budget in Originalwährung',
  'form.side.notChosen': 'Nicht gewählt',
  'form.side.noCurrency': '(Währung nicht gewählt)',
  'form.side.notSupplied': 'Nicht angegeben',
  'form.side.draftOnly': 'Nur ein Entwurf.',

  'form.message.claimFailed': 'Ihre Anfrage konnte nicht gesendet werden. Versuchen Sie es erneut.',
  'form.message.claimUnreadable':
    'Die Antwort auf die Anfrage war nicht lesbar. Öffnen Sie Ihr Konto, um sie zu prüfen.',
  'form.message.navigationMissing':
    'Die Seite der Anfrage lässt sich nicht öffnen. Öffnen Sie Ihr Konto, um fortzufahren.',
  'form.message.draftLostReal':
    'Ein gespeicherter Entwurf konnte nicht wiederhergestellt werden. Sichern Sie eine Kopie Ihrer Anfrage, bevor Sie diesen Tab verlassen.',
  'form.message.draftLostSample':
    'Ein gespeicherter Entwurf konnte nicht wiederhergestellt werden. Das Formular funktioniert weiter. Sichern Sie eine Kopie Ihrer erfundenen Anfrage, bevor Sie diesen Tab verlassen.',
  'form.message.draftResumed':
    'Ein Entwurf aus diesem Tab wurde fortgesetzt. Ihre gespeicherten Angaben haben Vorrang vor Vorschlägen aus Links.',
  'form.message.draftNotResumed': 'Der frühere Entwurf konnte nicht fortgesetzt werden.',
  'form.message.accountUnchecked':
    'Der Kontostatus konnte nicht geprüft werden. Melden Sie sich an oder versuchen Sie es erneut.',
  'form.message.pendingUnchecked':
    'Der Status der gespeicherten Anfrage konnte nicht geprüft werden. Versuchen Sie es erneut.',
  'form.message.paused':
    'Neue Anfragen sind pausiert. Bestehende Anfragen bleiben in Ihrem Konto verfügbar.',
  'form.message.opening': 'Ihre private Anfrage wird geöffnet…',
  'form.message.accountFailed': 'Ihr Konto konnte nicht geprüft werden.',
  'form.message.draftUnsavedReal':
    'Dieser Browser konnte den Entwurf nicht speichern. Lassen Sie diesen Tab offen und kopieren Sie Ihre Anfrage, bevor Sie ihn verlassen.',
  'form.message.draftUnsavedSample':
    'Dieser Browser konnte den Entwurf nicht speichern. Lassen Sie diesen Tab offen und kopieren Sie die erfundene Anfrage, bevor Sie ihn verlassen.',
  'form.message.chooseJob': 'Wählen Sie die geschäftliche Aufgabe.',
  'form.message.chooseCountry': 'Wählen Sie das Land des Unternehmens.',
  'form.message.chooseMarket': 'Wählen Sie den Zielmarkt.',
  'form.message.checkAmount': 'Prüfen Sie den Originalbetrag und die Währung.',
  'form.message.pausedSubmit':
    'Neue Anfragen sind pausiert. Öffnen Sie Ihr Konto für bestehende Arbeit.',
  'form.message.accountLoading': 'Warten Sie, bis Ihr Kontostatus geladen ist.',
  'form.message.emailMismatch':
    'Verwenden Sie die E-Mail-Adresse Ihres angemeldeten Kontos, oder melden Sie sich ab, um ein anderes Konto zu nutzen.',
  'form.message.passwordShort': 'Wählen Sie ein Kontopasswort mit mindestens 14 Zeichen.',
  'form.message.notSaved':
    'Ihre Anfrage konnte nicht gespeichert werden. Ihre Angaben bleiben erhalten.',
  'form.message.accountNotCreated':
    'Ihr Konto konnte nicht erstellt werden. Melden Sie sich an oder erstellen Sie Ihr Konto unten.',
  'form.message.duplicate': 'Diese erfundene Beispielanfrage wurde bereits erfasst.',
  'form.message.recorded': 'Ihre erfundene Beispielanfrage wurde erfasst.',
  'form.message.receiptUnsaved':
    'Die Anfrage wurde erfasst, aber dieser Browser konnte den Beleg nicht speichern. Kopieren Sie den privaten Code, bevor Sie die Seite verlassen.',
  'form.message.unableToSave': 'Speichern war nicht möglich. Ihre Angaben bleiben erhalten.',
  'form.message.copied': 'Privater Belegcode kopiert.',
  'form.message.copyFailed':
    'Der Code konnte nicht kopiert werden. Markieren und kopieren Sie ihn, bevor Sie diese Seite verlassen.',
  'form.message.unableToCheck': 'Der Beleg konnte nicht geprüft werden.',
  'form.message.openFailed': 'Ihre Anfrage konnte nicht geöffnet werden.',
  'form.message.untranslated': 'Diese Meldung wird auf Englisch angezeigt.',
  'form.message.consentLead': 'Lesen Sie den Hinweis und setzen Sie das Häkchen, um fortzufahren.',
  'form.message.intakeUnavailable':
    'Anfragen können gerade nicht gesendet werden. Ihre Angaben bleiben erhalten. Versuchen Sie es später erneut.',
  'form.message.activationNeeded':
    'Schließen Sie die Aktivierung Ihres Kontos ab, um Ihre Anfrage zu senden.',
  'form.message.checkFields': 'Prüfen Sie die markierten Felder.',
  'form.message.changed':
    'Diese Anfrage wurde nach dem Senden geändert. Beginnen Sie eine neue Anfrage.',
  'form.message.intakeNotSaved':
    'Die Anfrage konnte nicht gespeichert werden. Ihre Angaben bleiben erhalten.',
  'form.message.receiptExpired':
    'Dieser Beleg ist nicht verfügbar oder abgelaufen. Prüfen Sie den Code und versuchen Sie es erneut.',
  'form.message.receiptUnavailable':
    'Anfragen sind gerade nicht erreichbar. Versuchen Sie es später erneut.',
  'form.message.savedExpired':
    'Ihre gespeicherte Anfrage ist abgelaufen. Beginnen Sie eine neue Anfrage.',
  'form.message.realUnavailable':
    'Anfragen können gerade nicht angenommen werden. Ihre Angaben bleiben erhalten. Versuchen Sie es später erneut.',
  'form.message.requestUnavailable':
    'Anfragen können gerade nicht angenommen werden. Ihre Angaben bleiben erhalten. Versuchen Sie es später erneut.',
  'form.message.realIntakeUnavailable':
    'Anfragen können gerade nicht angenommen werden. Ihre Angaben bleiben erhalten. Versuchen Sie es später erneut.',
  'form.message.accessDenied':
    'Kein Zugriff, oder der Link ist nicht verfügbar. Melden Sie sich mit dem richtigen Konto an.',
  'form.message.checkValues': 'Prüfen Sie die gesendeten Angaben.',
  'form.message.conflict':
    'Die Anfrage passt nicht zum aktuellen Stand. Laden Sie die Seite neu und prüfen Sie sie erneut.',
  'form.message.notCompleted':
    'Die Anfrage konnte nicht abgeschlossen werden. Versuchen Sie es erneut.',
  'form.message.tooMany':
    'Zu viele Versuche. Versuchen Sie es in einer Stunde erneut. Ihre Angaben bleiben erhalten.',
  'form.message.handoffUnavailable':
    'Die gespeicherte Anfrage kann nicht übergeben werden. Öffnen Sie sie auf demselben Gerät und im selben Browser.',
  'form.message.workspaceUnavailable':
    'Der Bereich für Ihre Anfrage ist nicht verfügbar. Öffnen Sie Ihr Konto und versuchen Sie es erneut.',
  'form.message.identityUnavailable':
    'Ihr Konto kann gerade nicht geprüft werden. Versuchen Sie es erneut.',
  'form.message.signInNeeded': 'Melden Sie sich an, um fortzufahren.',
  'form.message.verifyNeeded': 'Bestätigen Sie Ihre E-Mail-Adresse, um fortzufahren.',
  'form.message.sessionInvalid': 'Ihre Anmeldung ist ungültig. Melden Sie sich erneut an.',
  'form.message.accountsUnavailable':
    'Kundenkonten sind gerade nicht verfügbar. Versuchen Sie es später erneut.',
  'form.message.verifiedEmailMissing':
    'Die bestätigte E-Mail-Adresse Ihres Kontos ist nicht verfügbar. Melden Sie sich erneut an.',
  'form.message.accountContextInvalid':
    'Die Kontoangaben sind ungültig. Laden Sie die Seite neu und versuchen Sie es erneut.',
  'form.message.accountChanged':
    'Ihr Konto hat sich geändert. Laden Sie die Seite neu, bevor Sie fortfahren.',
  'form.message.chooseObjective': 'Wählen Sie, was Sie tun möchten.',
  'form.message.enterMarket': 'Geben Sie Ihr Zielland oder Ihren Zielmarkt an.',
  'form.message.max120': 'Verwenden Sie höchstens 120 Zeichen.',
  'form.message.max160': 'Verwenden Sie höchstens 160 Zeichen.',
  'form.message.startDate': 'Geben Sie das Anfangsdatum Ihres Besuchs ein.',
  'form.message.endDate': 'Geben Sie das Enddatum Ihres Besuchs ein.',
  'form.message.endAfterStart': 'Das Enddatum darf nicht vor dem Anfangsdatum liegen.',
  'form.message.datesInPerson': 'Geben Sie Besuchsdaten nur an, wenn Sie persönlich vor Ort sind.',
  'form.message.tooShort': 'Geben Sie mindestens {minimum} Zeichen ein.',
  'form.message.tooLong': 'Verwenden Sie höchstens {maximum} Zeichen.',
  'form.message.timezone': 'Geben Sie eine gültige Zeitzone an.',
  'form.message.offerShort':
    'Beschreiben Sie Ihr Angebot oder Ihren Bedarf mit mindestens 10 Zeichen.',
  'form.message.website': 'Geben Sie eine gültige Webadresse mit http oder https ein.',
  'form.message.websiteLong': 'Verwenden Sie eine kürzere Webadresse.',
  'form.message.outcome': 'Wählen Sie mindestens ein Ergebnis.',
  'form.message.name': 'Geben Sie Ihren Namen ein.',
  'form.message.company': 'Geben Sie Ihr Unternehmen an.',
  'form.message.email': 'Prüfen Sie die E-Mail-Adresse.',
  'form.message.testEmail': 'Verwenden Sie eine Beispieladresse, die auf {domain} endet.',
  'form.message.quantity': 'Geben Sie die Menge als ganze Zahl ab 1 mit höchstens 12 Ziffern ein.',
  'form.message.unit': 'Geben Sie zur Menge eine Einheit an.',
  'form.message.budget':
    'Geben Sie zum Budget den Betrag, die Originalwährung und die Grundlage an.',
  'form.message.currency': 'Wählen Sie die Originalwährung.',
  'form.message.amountFormat':
    'Geben Sie den Originalbetrag ohne Minuszeichen ein, mit einem Punkt als Dezimalzeichen.',
  'form.message.decimals':
    '{code} erlaubt höchstens {places} Nachkommastellen. Es wird nicht gerundet.',
  'form.message.amountRange': 'Der Betrag ist größer als der unterstützte Bereich.',
  'form.message.offline':
    'Keine Verbindung. Ihre Angaben bleiben erhalten. Versuchen Sie es erneut, sobald Sie online sind.',
  'form.message.offlineFirefox':
    'Keine Verbindung. Ihre Angaben bleiben erhalten. Versuchen Sie es erneut, sobald Sie online sind.',
  'form.message.offlineSafari':
    'Keine Verbindung. Ihre Angaben bleiben erhalten. Versuchen Sie es erneut, sobald Sie online sind.',
};
