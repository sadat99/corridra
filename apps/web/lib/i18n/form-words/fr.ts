import type { FormCatalog } from './en';

// French request form words. Agent draft, not reviewed: shown only where the owner has released French in
// CORRIDRA_LANGUAGES_FORM after a recorded review (docs/product/language-review-record.md). Formal address (vous).
// A narrow no-break space ( ) stands before ? ! : and ;.
export const words: FormCatalog = {
  'form.head.label': 'Planifier une mission',
  'form.head.title': 'Que souhaitez-vous faire ?',
  'form.head.realLead': 'Commencez par votre objectif.',
  'form.head.sampleLead': 'Une demande courte suffit. Aucun compte n’est nécessaire.',

  'form.notice.realPill': 'Votre demande',
  'form.notice.realLead': 'Commencez par le travail dont vous avez besoin.',
  'form.notice.samplePill': 'Mode exemple',
  'form.notice.sampleLead':
    'Les demandes d’exemple sont ouvertes. Les vraies missions clients ne sont pas acceptées.',
  'form.notice.sampleUse':
    'Utilisez des informations fictives et une adresse e-mail se terminant par {domain}.',
  'form.notice.sampleReceipt': 'Gardez votre reçu pour lire les réponses.',
  'form.notice.sampleEmail': 'L’envoi d’e-mails n’est pas activé.',
  'form.notice.englishParts':
    'Les phrases sur la confidentialité, le consentement et la durée de conservation sont en anglais.',

  'form.pending.title': 'Finalisez votre demande.',
  'form.pending.sameDevice':
    'Utilisez le même appareil et le même navigateur pour activer votre compte et vous connecter. Ensuite, votre demande est soumise à Corridra.',
  'form.pending.open': 'Ouvrir votre demande',
  'form.pending.activate': 'Activer votre compte',
  'form.pending.signIn': 'Se connecter et continuer',
  'form.pending.create': 'Créer votre compte',
  'form.pending.codeSignIn': 'Se connecter avec un code pour voir votre demande',
  'form.pending.return': 'Revenir au formulaire',

  'form.step.counter': 'Étape {step} sur {total}',
  'form.step.goal': 'Objectif',
  'form.step.where': 'Lieu',
  'form.step.details': 'Détails',
  'form.step.results': 'Résultats',
  'form.step.contact': 'Contact',
  'form.step.journey': 'Étapes de la demande',
  'form.step.progress': 'Avancement de la demande',
  'form.step.titleGoal': 'Que cherchez-vous à obtenir ?',
  'form.step.titleWhere': 'Où ?',
  'form.step.titleDetails': 'Que proposez-vous ou que recherchez-vous ?',
  'form.step.titleResults': 'Quel résultat aurait de la valeur pour vous ?',
  'form.step.titleContact': 'Où devons-nous répondre ?',

  'form.summary.title': 'Vérifiez cette étape.',
  'form.summary.body':
    'Vérifiez les champs signalés avant de continuer. Vos saisies sont conservées.',

  'form.goal.legend': 'Objectif de la mission',
  'form.goal.sell': 'Vendre sur un nouveau marché',
  'form.goal.customers': 'Trouver des clients ou des distributeurs',
  'form.goal.source': 'Trouver des fournisseurs',
  'form.goal.trip': 'Rendre un prochain voyage d’affaires plus productif',
  'form.goal.mission': 'Mener une mission avec plusieurs entreprises',
  'form.goal.other': 'Autre chose',
  'form.goal.job': 'Travail commercial',
  'form.goal.choose': 'Choisir le travail',
  'form.goal.hint': 'Choisissez un travail plus précis si vous le connaissez.',

  'form.job.buyers': 'Trouver des acheteurs',
  'form.job.customers': 'Trouver des clients',
  'form.job.distributors': 'Trouver des distributeurs',
  'form.job.partners': 'Trouver des partenaires commerciaux',
  'form.job.sourcing': 'Acheter des produits ou des composants',
  'form.job.machinery_procurement': 'Acheter des machines',
  'form.job.supplier_evaluation': 'Évaluer des fournisseurs',
  'form.job.meetings': 'Organiser des rendez-vous commerciaux',
  'form.job.factory_visits': 'Visiter des sites',
  'form.job.trade_fairs': 'Mieux profiter des salons professionnels',
  'form.job.business_trips': 'Organiser un voyage d’affaires',
  'form.job.market_validation': 'Évaluer un marché',
  'form.job.market_entry': 'Entrer sur un marché',
  'form.job.export_market_access': 'Développer l’accès à l’export',
  'form.job.delegations': 'Mener une mission avec plusieurs entreprises',

  'form.where.company': 'Où l’entreprise est-elle établie ?',
  'form.where.chooseCountry': 'Choisir un pays',
  'form.where.market': 'Quel marché est concerné ?',
  'form.where.chooseMarket': 'Choisir un marché',
  'form.where.eu': 'Union européenne (bloc commercial)',
  'form.where.hint':
    'Le pays de l’entreprise et le marché cible ne fixent ni le lieu d’expédition ni le lieu des rendez-vous.',
  'form.where.realOther':
    'Dites-nous ce dont vous avez besoin. La disponibilité et le périmètre pour cette direction doivent être convenus après examen.',
  'form.where.sampleOther':
    'Aucune offre active n’est annoncée pour cette direction. Vous pouvez quand même décrire une mission d’exemple fictive.',
  'form.where.when': 'Quand l’activité est-elle nécessaire ? (facultatif)',
  'form.where.attendance': 'Serez-vous présent en personne ?',
  'form.where.yes': 'Oui',
  'form.where.no': 'Non',
  'form.where.undecided': 'Non décidé',
  'form.where.from': 'Du',
  'form.where.to': 'Au',
  'form.where.timezone': 'Fuseau horaire de la visite',

  'form.details.offer': 'Votre offre ou votre besoin',
  'form.details.offerExample':
    'Exemple : nous fabriquons des serviettes d’hôtel au Bangladesh et voulons rencontrer des distributeurs espagnols de l’hôtellerie qui achètent des produits sous marque propre.',
  'form.details.offerHint':
    'Commencez par ce que vous savez. Vous pouvez décrire une photo de produit, une idée, un fournisseur actuel ou un devis. Les caractéristiques manquantes peuvent être précisées plus tard. L’analyse d’images n’est pas disponible ici.',
  'form.details.technicalPurpose': 'Usage technique (facultatif)',
  'form.details.technicalParameters': 'Principaux paramètres techniques (facultatif)',
  'form.details.siteConstraints':
    'Contraintes de site, d’intégration ou de service après-vente (facultatif)',
  'form.details.specifications': 'Caractéristiques du produit (facultatif)',
  'form.details.quantity': 'Quantité requise (facultatif)',
  'form.details.unit': 'Unité de quantité (requise avec une quantité)',
  'form.details.supplierPreferences': 'Préférences et contraintes fournisseurs (facultatif)',
  'form.details.targetBuyer': 'Acheteur ou distributeur visé (facultatif)',
  'form.details.readiness': 'Préparation commerciale et contraintes (facultatif)',
  'form.details.organiser': 'Organisateur de la délégation (facultatif)',
  'form.details.participants': 'Organisations participantes et besoins de chacune (facultatif)',
  'form.details.delegationHint': 'Chaque participant reçoit une mission distincte.',
  'form.details.website': 'Site web ou URL du catalogue (facultatif)',
  'form.details.websiteHint':
    'Un lien public aide. Nous ne l’ouvrons pas automatiquement. Des documents peuvent être demandés après examen.',

  'form.budget.summary': 'Budget (facultatif)',
  'form.budget.amount': 'Budget dans la devise d’origine (facultatif)',
  'form.budget.currency': 'Devise d’origine',
  'form.budget.none': 'Aucun budget indiqué',
  'form.budget.option': '{code} ({places} décimales)',
  'form.budget.basis': 'Base du budget, par exemple budget total des équipements',
  'form.budget.hint':
    'Saisissez le montant tel qu’il a été indiqué, par exemple {cny} ou {bhd}, avec un point comme séparateur décimal. Respectez les décimales de la devise choisie. Aucune conversion de devise n’est effectuée.',

  'form.results.worthwhile': 'Quel résultat rendrait cette collaboration utile ? (facultatif)',
  'form.results.legend': 'Résultats souhaités',
  'form.results.meetings': 'Rendez-vous pertinents',
  'form.results.buyers': 'Acheteurs / clients',
  'form.results.distributors': 'Échanges avec des distributeurs',
  'form.results.supplierVisits': 'Visites de fournisseurs',
  'form.results.validation': 'Évaluation du marché',
  'form.results.intelligence': 'Informations commerciales locales',
  'form.results.other': 'Autre chose',
  'form.results.notes': 'Y a-t-il quelque chose de précis à savoir ? (facultatif)',
  'form.results.contextHint':
    'Dites-nous où en sont les choses et de quelle aide vous avez besoin ensuite. Un fournisseur actuel, une spécification approuvée, un voyage réservé ou une négociation en cours peut être votre point de départ.',

  'form.contact.name': 'Nom',
  'form.contact.company': 'Entreprise',
  'form.contact.email': 'E-mail professionnel',
  'form.contact.password': 'Créer un mot de passe de compte',
  'form.contact.passwordHint': 'Utilisez au moins 14 caractères.',
  'form.contact.signedInAs': 'Connecté en tant que {email}.',
  'form.contact.haveAccount': 'Vous avez déjà un compte ?',
  'form.contact.signInReturn': 'Se connecter et revenir à cette demande',
  'form.contact.realHint': 'Nous examinons votre demande et proposons les prochaines étapes.',
  'form.contact.sampleHint':
    'Aucun compte n’est nécessaire. Nous examinons d’abord votre demande, puis proposons les prochaines étapes. Utilisez votre reçu pour lire les réponses.',

  'form.action.back': 'Retour',
  'form.action.continue': 'Continuer',
  'form.action.saving': 'Enregistrement…',
  'form.action.createAccount': 'Créer un compte et continuer',
  'form.action.submit': 'Envoyer la demande',
  'form.action.clearDraft': 'Effacer le brouillon',

  'form.receipt.label': 'Demande enregistrée',
  'form.receipt.title': 'Gardez votre reçu privé.',
  'form.receipt.saveBeforeClosing': 'Enregistrez-le avant de fermer cet onglet.',
  'form.receipt.forget': 'Oublier cette demande sur cet appareil',
  'form.receipt.code': 'Code de reçu privé',
  'form.receipt.copy': 'Copier le code de reçu',
  'form.receipt.another': 'Nouvelle demande (gardez d’abord votre reçu)',

  'form.check.realTitle': 'Vérifier un reçu précédent.',
  'form.check.sampleTitle': 'Vérifier une demande de mission.',
  'form.check.code': 'Code de reçu',
  'form.check.submit': 'Voir le statut et les réponses',
  'form.check.status': 'Statut : {status}',
  'form.check.noReply': 'Pas encore de réponse de l’Équipe Corridra.',

  'form.side.realLabel': 'Votre demande',
  'form.side.sampleLabel': 'Votre demande d’exemple',
  'form.side.realHeading': 'Votre demande',
  'form.side.sampleHeading': 'Votre demande d’exemple',
  'form.side.objective': 'Objectif',
  'form.side.country': 'Pays de l’entreprise',
  'form.side.market': 'Marché cible',
  'form.side.budget': 'Budget d’origine',
  'form.side.notChosen': 'Non choisi',
  'form.side.noCurrency': '(devise non choisie)',
  'form.side.notSupplied': 'Non indiqué',
  'form.side.draftOnly': 'Brouillon uniquement.',

  'form.message.claimFailed': 'Votre demande n’a pas pu être envoyée. Réessayez.',
  'form.message.claimUnreadable':
    'La réponse à la demande est illisible. Ouvrez votre compte pour la vérifier.',
  'form.message.navigationMissing':
    'La page de la demande ne s’ouvre pas. Ouvrez votre compte pour continuer.',
  'form.message.draftLostReal':
    'Un brouillon enregistré n’a pas pu être restauré. Gardez une copie de votre demande avant de quitter cet onglet.',
  'form.message.draftLostSample':
    'Un brouillon enregistré n’a pas pu être restauré. Le formulaire fonctionne toujours. Gardez une copie de votre demande fictive avant de quitter cet onglet.',
  'form.message.draftResumed':
    'Un brouillon de cet onglet a été repris. Vos choix enregistrés priment sur les suggestions des liens.',
  'form.message.draftNotResumed': 'Le brouillon précédent n’a pas pu être repris.',
  'form.message.accountUnchecked':
    'L’état du compte n’a pas pu être vérifié. Connectez-vous ou réessayez.',
  'form.message.pendingUnchecked':
    'L’état de la demande enregistrée n’a pas pu être vérifié. Réessayez.',
  'form.message.paused':
    'Les nouvelles demandes sont suspendues. Les demandes existantes restent disponibles dans votre compte.',
  'form.message.opening': 'Ouverture de votre demande privée…',
  'form.message.accountFailed': 'Votre compte n’a pas pu être vérifié.',
  'form.message.draftUnsavedReal':
    'Ce navigateur n’a pas pu enregistrer le brouillon. Gardez cet onglet ouvert et copiez votre demande avant de partir.',
  'form.message.draftUnsavedSample':
    'Ce navigateur n’a pas pu enregistrer le brouillon. Gardez cet onglet ouvert et copiez la demande fictive avant de partir.',
  'form.message.chooseJob': 'Choisissez le travail commercial.',
  'form.message.chooseCountry': 'Choisissez le pays de l’entreprise.',
  'form.message.chooseMarket': 'Choisissez le marché cible.',
  'form.message.checkAmount': 'Vérifiez le montant d’origine et la devise.',
  'form.message.pausedSubmit':
    'Les nouvelles demandes sont suspendues. Ouvrez votre compte pour le travail existant.',
  'form.message.accountLoading': 'Attendez la fin du chargement de l’état de votre compte.',
  'form.message.emailMismatch':
    'Utilisez l’adresse e-mail de votre compte connecté, ou déconnectez-vous pour utiliser un autre compte.',
  'form.message.passwordShort': 'Choisissez un mot de passe de compte d’au moins 14 caractères.',
  'form.message.notSaved':
    'Votre demande n’a pas pu être enregistrée. Vos saisies sont conservées.',
  'form.message.accountNotCreated':
    'Votre compte n’a pas pu être créé. Connectez-vous ou créez votre compte ci-dessous.',
  'form.message.duplicate': 'Cette demande d’exemple fictive a déjà été enregistrée.',
  'form.message.recorded': 'Votre demande d’exemple fictive a été enregistrée.',
  'form.message.receiptUnsaved':
    'La demande a été enregistrée, mais ce navigateur n’a pas pu garder son reçu. Copiez le code privé avant de partir.',
  'form.message.unableToSave': 'Enregistrement impossible. Vos saisies sont conservées.',
  'form.message.copied': 'Code de reçu privé copié.',
  'form.message.copyFailed':
    'Le code n’a pas pu être copié. Sélectionnez-le et copiez-le avant de quitter cette page.',
  'form.message.unableToCheck': 'Le reçu n’a pas pu être vérifié.',
  'form.message.openFailed': 'Votre demande n’a pas pu être ouverte.',
  'form.message.untranslated': 'Ce message s’affiche en anglais.',
  'form.message.consentLead': 'Lisez l’avis et cochez la case pour continuer.',
  'form.message.intakeUnavailable':
    'Les demandes ne peuvent pas être envoyées. Vos saisies sont conservées.',
  'form.message.activationNeeded':
    'Terminez l’activation de votre compte pour envoyer votre demande.',
  'form.message.checkFields': 'Vérifiez les champs signalés.',
  'form.message.changed': 'Cette demande a changé après l’envoi. Commencez une nouvelle demande.',
  'form.message.intakeNotSaved':
    'La demande n’a pas pu être enregistrée. Vos saisies sont conservées.',
  'form.message.receiptExpired':
    'Ce reçu est indisponible ou expiré. Vérifiez le code et réessayez.',
  'form.message.receiptUnavailable': 'Les reçus ne peuvent pas être vérifiés.',
  'form.message.savedExpired':
    'Votre demande enregistrée a expiré. Commencez une nouvelle demande.',
  'form.message.realUnavailable':
    'Les demandes ne peuvent pas être reçues. Vos saisies sont conservées.',
  'form.message.requestUnavailable':
    'Les demandes ne peuvent pas être reçues. Vos saisies sont conservées.',
  'form.message.realIntakeUnavailable':
    'Les demandes ne peuvent pas être reçues. Vos saisies sont conservées.',
  'form.message.accessDenied':
    'Accès refusé, ou le lien n’est pas disponible. Connectez-vous avec le bon compte.',
  'form.message.checkValues': 'Vérifiez les informations envoyées.',
  'form.message.conflict':
    'La demande ne correspond pas à l’état actuel. Rechargez la page et vérifiez-la à nouveau.',
  'form.message.notCompleted': 'La demande n’a pas pu aboutir. Réessayez.',
  'form.message.tooMany':
    'Trop de tentatives. Réessayez dans une heure. Vos saisies sont conservées.',
  'form.message.handoffUnavailable':
    'La demande enregistrée ne peut pas être transmise. Ouvrez-la sur le même appareil et le même navigateur.',
  'form.message.workspaceUnavailable':
    'L’espace de votre demande n’est pas disponible. Ouvrez votre compte et réessayez.',
  'form.message.identityUnavailable':
    'Votre compte ne peut pas être vérifié pour le moment. Réessayez.',
  'form.message.signInNeeded': 'Connectez-vous pour continuer.',
  'form.message.verifyNeeded': 'Confirmez votre adresse e-mail pour continuer.',
  'form.message.sessionInvalid': 'Votre connexion n’a pas pu être confirmée. Reconnectez-vous.',
  'form.message.accountsUnavailable': 'Les comptes clients ne sont pas disponibles.',
  'form.message.verifiedEmailMissing':
    'L’adresse e-mail confirmée de votre compte n’est pas disponible. Reconnectez-vous.',
  'form.message.accountContextInvalid':
    'Les informations du compte sur cette page n’ont pas pu être lues. Rechargez la page et réessayez.',
  'form.message.accountChanged': 'Votre compte a changé. Rechargez la page avant de continuer.',
  'form.message.chooseObjective': 'Choisissez ce que vous souhaitez faire.',
  'form.message.enterMarket': 'Indiquez votre pays ou marché cible.',
  'form.message.max120': 'Utilisez au plus 120 caractères.',
  'form.message.max160': 'Utilisez au plus 160 caractères.',
  'form.message.startDate': 'Saisissez la date de début de votre visite.',
  'form.message.endDate': 'Saisissez la date de fin de votre visite.',
  'form.message.endAfterStart': 'La date de fin ne peut pas précéder la date de début.',
  'form.message.datesInPerson':
    'Indiquez des dates de visite seulement si vous êtes présent en personne.',
  'form.message.tooShort': 'Saisissez au moins {minimum} caractères.',
  'form.message.tooLong': 'Utilisez au plus {maximum} caractères.',
  'form.message.timezone': 'Indiquez un fuseau horaire valide.',
  'form.message.offerShort': 'Décrivez votre offre ou votre besoin en au moins 10 caractères.',
  'form.message.website': 'Saisissez une adresse web valide en http ou https.',
  'form.message.websiteLong': 'Utilisez une adresse web plus courte.',
  'form.message.outcome': 'Choisissez au moins un résultat.',
  'form.message.name': 'Saisissez votre nom.',
  'form.message.company': 'Indiquez votre entreprise.',
  'form.message.email': 'Vérifiez l’adresse e-mail.',
  'form.message.testEmail': 'Utilisez une adresse d’exemple se terminant par {domain}.',
  'form.message.quantity':
    'Saisissez la quantité en nombre entier à partir de 1, de 12 chiffres au plus.',
  'form.message.unit': 'Indiquez une unité pour la quantité.',
  'form.message.budget': 'Pour le budget, indiquez le montant, la devise d’origine et la base.',
  'form.message.currency': 'Choisissez la devise d’origine.',
  'form.message.amountFormat':
    'Saisissez le montant d’origine, positif ou nul, avec un point comme séparateur décimal.',
  'form.message.decimals':
    '{code} accepte au plus {places} décimales. Aucun arrondi n’est effectué.',
  'form.message.amountRange': 'Le montant dépasse la plage prise en charge.',
  'form.message.offline':
    'Pas de connexion. Vos saisies sont conservées. Réessayez une fois connecté.',
  'form.message.offlineFirefox':
    'Pas de connexion. Vos saisies sont conservées. Réessayez une fois connecté.',
  'form.message.offlineSafari':
    'Pas de connexion. Vos saisies sont conservées. Réessayez une fois connecté.',
};
