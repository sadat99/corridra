import type { FormCatalog } from './en';

// Spanish request form words. Agent draft, not reviewed: shown only where the owner has released Spanish in
// CORRIDRA_LANGUAGES_FORM after a recorded review (docs/product/language-review-record.md). Formal address (usted).
export const words: FormCatalog = {
  'form.head.label': 'Planificar una misión',
  'form.head.title': '¿Qué desea hacer?',
  'form.head.realLead': 'Empiece por su objetivo.',
  'form.head.sampleLead': 'Basta con una solicitud breve. No necesita una cuenta.',

  'form.notice.realPill': 'Su solicitud',
  'form.notice.realLead': 'Empiece por el trabajo que necesita.',
  'form.notice.samplePill': 'Modo de ejemplo',
  'form.notice.sampleLead':
    'Las solicitudes de ejemplo están abiertas. No se aceptan misiones reales de clientes.',
  'form.notice.sampleUse': 'Use datos inventados y un correo que termine en {domain}.',
  'form.notice.sampleReceipt': 'Guarde su recibo para leer las respuestas.',
  'form.notice.sampleEmail': 'El envío de correos no está activado.',
  'form.notice.englishParts':
    'Las frases sobre privacidad, consentimiento y plazo de conservación están en inglés.',

  'form.pending.title': 'Complete su solicitud.',
  'form.pending.sameDevice':
    'Use el mismo dispositivo y el mismo navegador para activar su cuenta e iniciar sesión. Después, su solicitud se presenta a Corridra.',
  'form.pending.open': 'Abrir su solicitud',
  'form.pending.activate': 'Activar su cuenta',
  'form.pending.signIn': 'Iniciar sesión y continuar',
  'form.pending.create': 'Crear su cuenta',
  'form.pending.codeSignIn': 'Iniciar sesión con un código para ver su solicitud',
  'form.pending.return': 'Volver al formulario',

  'form.step.counter': 'Paso {step} de {total}',
  'form.step.goal': 'Objetivo',
  'form.step.where': 'Lugar',
  'form.step.details': 'Detalles',
  'form.step.results': 'Resultados',
  'form.step.contact': 'Contacto',
  'form.step.journey': 'Pasos de la solicitud',
  'form.step.progress': 'Avance de la solicitud',
  'form.step.titleGoal': '¿Qué quiere lograr?',
  'form.step.titleWhere': '¿Dónde?',
  'form.step.titleDetails': '¿Qué ofrece o qué busca?',
  'form.step.titleResults': '¿Qué resultado le sería útil?',
  'form.step.titleContact': '¿Dónde debemos responder?',

  'form.summary.title': 'Revise este paso.',
  'form.summary.body': 'Revise los campos marcados antes de continuar. Sus datos siguen aquí.',

  'form.goal.legend': 'Objetivo de la misión',
  'form.goal.sell': 'Vender en un mercado nuevo',
  'form.goal.customers': 'Encontrar clientes o distribuidores',
  'form.goal.source': 'Encontrar proveedores',
  'form.goal.trip': 'Aprovechar mejor un próximo viaje de negocios',
  'form.goal.mission': 'Realizar una misión con varias empresas',
  'form.goal.other': 'Otra cosa',
  'form.goal.job': 'Trabajo comercial',
  'form.goal.choose': 'Elegir el trabajo',
  'form.goal.hint': 'Elija un trabajo más concreto si lo conoce.',

  'form.job.buyers': 'Encontrar compradores',
  'form.job.customers': 'Encontrar clientes',
  'form.job.distributors': 'Encontrar distribuidores',
  'form.job.partners': 'Encontrar socios comerciales',
  'form.job.sourcing': 'Comprar productos o componentes',
  'form.job.machinery_procurement': 'Comprar maquinaria',
  'form.job.supplier_evaluation': 'Evaluar proveedores',
  'form.job.meetings': 'Organizar reuniones comerciales',
  'form.job.factory_visits': 'Visitar instalaciones',
  'form.job.trade_fairs': 'Aprovechar mejor las ferias comerciales',
  'form.job.business_trips': 'Organizar un viaje de negocios',
  'form.job.market_validation': 'Evaluar un mercado',
  'form.job.market_entry': 'Entrar en un mercado',
  'form.job.export_market_access': 'Desarrollar el acceso a la exportación',
  'form.job.delegations': 'Realizar una misión con varias empresas',

  'form.where.company': '¿Dónde tiene su sede la empresa?',
  'form.where.chooseCountry': 'Elegir un país',
  'form.where.market': '¿Qué mercado le interesa?',
  'form.where.chooseMarket': 'Elegir un mercado',
  'form.where.eu': 'Unión Europea (bloque comercial)',
  'form.where.hint':
    'El país de la empresa y el mercado de destino no fijan el lugar de envío ni el de las reuniones.',
  'form.where.realOther':
    'Díganos qué necesita. La disponibilidad y el alcance para esta dirección deben acordarse tras la revisión.',
  'form.where.sampleOther':
    'No hay ninguna oferta activa anunciada para esta dirección. Aun así, puede describir una misión de ejemplo inventada.',
  'form.where.when': '¿Cuándo se necesita la actividad? (opcional)',
  'form.where.attendance': '¿Estará presente en persona?',
  'form.where.yes': 'Sí',
  'form.where.no': 'No',
  'form.where.undecided': 'Sin decidir',
  'form.where.from': 'Desde',
  'form.where.to': 'Hasta',
  'form.where.timezone': 'Zona horaria de la visita',

  'form.details.offer': 'Su oferta o necesidad',
  'form.details.offerExample':
    'Ejemplo: fabricamos toallas de hotel en Bangladés y queremos conocer distribuidores españoles de hostelería que compren productos de marca propia.',
  'form.details.offerHint':
    'Empiece por lo que sabe. Puede describir una foto del producto, una idea, un proveedor actual o una cotización. Las especificaciones que falten se pueden aclarar más tarde. La interpretación de imágenes no está disponible aquí.',
  'form.details.technicalPurpose': 'Finalidad técnica (opcional)',
  'form.details.technicalParameters': 'Parámetros técnicos clave (opcional)',
  'form.details.siteConstraints': 'Condiciones de instalación, integración o posventa (opcional)',
  'form.details.specifications': 'Especificaciones del producto (opcional)',
  'form.details.quantity': 'Cantidad necesaria (opcional)',
  'form.details.unit': 'Unidad de cantidad (obligatoria con una cantidad)',
  'form.details.supplierPreferences': 'Preferencias y condiciones sobre proveedores (opcional)',
  'form.details.targetBuyer': 'Comprador o distribuidor buscado (opcional)',
  'form.details.readiness': 'Situación comercial y condiciones (opcional)',
  'form.details.organiser': 'Organizador de la delegación (opcional)',
  'form.details.participants': 'Organizaciones participantes y necesidades de cada una (opcional)',
  'form.details.delegationHint': 'Cada participante recibe una misión independiente.',
  'form.details.website': 'Sitio web o URL del catálogo (opcional)',
  'form.details.websiteHint':
    'Un enlace público ayuda. No lo abrimos automáticamente. Se pueden pedir documentos tras la revisión.',

  'form.budget.summary': 'Presupuesto (opcional)',
  'form.budget.amount': 'Presupuesto en la moneda original (opcional)',
  'form.budget.currency': 'Moneda original',
  'form.budget.none': 'Sin presupuesto',
  'form.budget.option': '{code} ({places} decimales)',
  'form.budget.basis': 'Base del presupuesto, por ejemplo presupuesto total de equipos',
  'form.budget.hint':
    'Escriba el importe tal como se cotizó, por ejemplo {cny} o {bhd}, con un punto como separador decimal. Use los decimales de la moneda elegida. No se realiza ninguna conversión de moneda.',

  'form.results.worthwhile': '¿Qué resultado haría útil este trabajo? (opcional)',
  'form.results.legend': 'Resultados deseados',
  'form.results.meetings': 'Reuniones relevantes',
  'form.results.buyers': 'Compradores / clientes',
  'form.results.distributors': 'Conversaciones con distribuidores',
  'form.results.supplierVisits': 'Visitas a proveedores',
  'form.results.validation': 'Evaluación del mercado',
  'form.results.intelligence': 'Información comercial local',
  'form.results.other': 'Otra cosa',
  'form.results.notes': '¿Hay algo concreto que debamos saber? (opcional)',
  'form.results.contextHint':
    'Cuéntenos en qué punto está y qué ayuda necesita ahora. Un proveedor actual, una especificación aprobada, un viaje reservado o una negociación en curso pueden ser su punto de partida.',

  'form.contact.name': 'Nombre',
  'form.contact.company': 'Empresa',
  'form.contact.email': 'Correo de trabajo',
  'form.contact.password': 'Crear una contraseña para la cuenta',
  'form.contact.passwordHint': 'Use al menos 14 caracteres.',
  'form.contact.signedInAs': 'Sesión iniciada como {email}.',
  'form.contact.haveAccount': '¿Ya tiene una cuenta?',
  'form.contact.signInReturn': 'Iniciar sesión y volver a esta solicitud',
  'form.contact.realHint': 'Revisamos su solicitud y proponemos los siguientes pasos.',
  'form.contact.sampleHint':
    'No necesita una cuenta. Primero revisamos su solicitud y luego proponemos los siguientes pasos. Use su recibo para leer las respuestas.',

  'form.action.back': 'Atrás',
  'form.action.continue': 'Continuar',
  'form.action.saving': 'Guardando…',
  'form.action.createAccount': 'Crear cuenta y continuar',
  'form.action.submit': 'Enviar la solicitud',
  'form.action.clearDraft': 'Borrar el borrador',

  'form.receipt.label': 'Solicitud guardada',
  'form.receipt.title': 'Guarde su recibo privado.',
  'form.receipt.saveBeforeClosing': 'Guárdelo antes de cerrar esta pestaña.',
  'form.receipt.forget': 'Olvidar esta solicitud en este dispositivo',
  'form.receipt.code': 'Código de recibo privado',
  'form.receipt.copy': 'Copiar el código de recibo',
  'form.receipt.another': 'Nueva solicitud (guarde antes su recibo)',

  'form.check.realTitle': 'Consultar un recibo anterior.',
  'form.check.sampleTitle': 'Consultar una solicitud de misión.',
  'form.check.code': 'Código de recibo',
  'form.check.submit': 'Ver estado y respuestas',
  'form.check.status': 'Estado: {status}',
  'form.check.noReply': 'Todavía no hay respuesta del Equipo de Corridra.',

  'form.side.realLabel': 'Su solicitud',
  'form.side.sampleLabel': 'Su solicitud de ejemplo',
  'form.side.realHeading': 'Su solicitud',
  'form.side.sampleHeading': 'Su solicitud de ejemplo',
  'form.side.objective': 'Objetivo',
  'form.side.country': 'País de la empresa',
  'form.side.market': 'Mercado de destino',
  'form.side.budget': 'Presupuesto original',
  'form.side.notChosen': 'Sin elegir',
  'form.side.noCurrency': '(moneda sin elegir)',
  'form.side.notSupplied': 'No indicado',
  'form.side.draftOnly': 'Solo es un borrador.',

  'form.message.claimFailed': 'No se pudo enviar su solicitud. Inténtelo de nuevo.',
  'form.message.claimUnreadable':
    'No se pudo leer la respuesta a la solicitud. Abra su cuenta para comprobarla.',
  'form.message.navigationMissing':
    'No se puede abrir la página de la solicitud. Abra su cuenta para continuar.',
  'form.message.draftLostReal':
    'No se pudo recuperar un borrador guardado. Guarde una copia de su solicitud antes de salir de esta pestaña.',
  'form.message.draftLostSample':
    'No se pudo recuperar un borrador guardado. El formulario sigue funcionando. Guarde una copia de su solicitud inventada antes de salir de esta pestaña.',
  'form.message.draftResumed':
    'Se ha retomado un borrador de esta pestaña. Sus opciones guardadas tienen prioridad sobre las sugerencias de los enlaces.',
  'form.message.draftNotResumed': 'No se pudo retomar el borrador anterior.',
  'form.message.accountUnchecked':
    'No se pudo comprobar el estado de la cuenta. Inicie sesión o inténtelo de nuevo.',
  'form.message.pendingUnchecked':
    'No se pudo comprobar el estado de la solicitud guardada. Inténtelo de nuevo.',
  'form.message.paused':
    'Las solicitudes nuevas están en pausa. Las solicitudes existentes siguen disponibles en su cuenta.',
  'form.message.opening': 'Abriendo su solicitud privada…',
  'form.message.accountFailed': 'No se pudo comprobar su cuenta.',
  'form.message.draftUnsavedReal':
    'Este navegador no pudo guardar el borrador. Mantenga esta pestaña abierta y copie su solicitud antes de salir.',
  'form.message.draftUnsavedSample':
    'Este navegador no pudo guardar el borrador. Mantenga esta pestaña abierta y copie la solicitud inventada antes de salir.',
  'form.message.chooseJob': 'Elija el trabajo comercial.',
  'form.message.chooseCountry': 'Elija el país de la empresa.',
  'form.message.chooseMarket': 'Elija el mercado de destino.',
  'form.message.checkAmount': 'Revise el importe original y la moneda.',
  'form.message.pausedSubmit':
    'Las solicitudes nuevas están en pausa. Abra su cuenta para el trabajo existente.',
  'form.message.accountLoading': 'Espere a que termine de cargarse el estado de su cuenta.',
  'form.message.emailMismatch':
    'Use la dirección de correo de la cuenta con la que inició sesión, o cierre la sesión para usar otra cuenta.',
  'form.message.passwordShort': 'Elija una contraseña de cuenta de al menos 14 caracteres.',
  'form.message.notSaved': 'No se pudo guardar su solicitud. Sus datos siguen aquí.',
  'form.message.accountNotCreated':
    'No se pudo crear su cuenta. Inicie sesión o cree su cuenta más abajo.',
  'form.message.duplicate': 'Esta solicitud de ejemplo inventada ya se ha registrado.',
  'form.message.recorded': 'Su solicitud de ejemplo inventada se ha registrado.',
  'form.message.receiptUnsaved':
    'La solicitud se registró, pero este navegador no pudo guardar su recibo. Copie el código privado antes de salir.',
  'form.message.unableToSave': 'No se pudo guardar. Sus datos siguen aquí.',
  'form.message.copied': 'Código de recibo privado copiado.',
  'form.message.copyFailed':
    'No se pudo copiar el código. Selecciónelo y cópielo antes de salir de esta página.',
  'form.message.unableToCheck': 'No se pudo consultar el recibo.',
  'form.message.openFailed': 'No se pudo abrir su solicitud.',
  'form.message.untranslated': 'Este mensaje se muestra en inglés.',
  'form.message.consentLead': 'Lea el aviso y marque la casilla para continuar.',
  'form.message.intakeUnavailable': 'No se pueden enviar solicitudes. Sus datos siguen aquí.',
  'form.message.activationNeeded': 'Termine de activar su cuenta para enviar su solicitud.',
  'form.message.checkFields': 'Revise los campos marcados.',
  'form.message.changed': 'Esta solicitud cambió después del envío. Empiece una solicitud nueva.',
  'form.message.intakeNotSaved': 'No se pudo guardar la solicitud. Sus datos siguen aquí.',
  'form.message.receiptExpired':
    'Este recibo no está disponible o ha caducado. Revise el código e inténtelo de nuevo.',
  'form.message.receiptUnavailable': 'No se pueden consultar los recibos.',
  'form.message.savedExpired': 'Su solicitud guardada ha caducado. Empiece una solicitud nueva.',
  'form.message.realUnavailable': 'No se pueden recibir solicitudes. Sus datos siguen aquí.',
  'form.message.requestUnavailable': 'No se pueden recibir solicitudes. Sus datos siguen aquí.',
  'form.message.realIntakeUnavailable': 'No se pueden recibir solicitudes. Sus datos siguen aquí.',
  'form.message.accessDenied':
    'Acceso denegado, o el enlace no está disponible. Inicie sesión con la cuenta correcta.',
  'form.message.checkValues': 'Revise los datos enviados.',
  'form.message.conflict':
    'La solicitud no coincide con el estado actual. Actualice la página y revísela de nuevo.',
  'form.message.notCompleted': 'No se pudo completar la solicitud. Inténtelo de nuevo.',
  'form.message.tooMany':
    'Demasiados intentos. Inténtelo de nuevo dentro de una hora. Sus datos siguen aquí.',
  'form.message.handoffUnavailable':
    'No se puede entregar la solicitud guardada. Ábrala en el mismo dispositivo y el mismo navegador.',
  'form.message.workspaceUnavailable':
    'El espacio de su solicitud no está disponible. Abra su cuenta e inténtelo de nuevo.',
  'form.message.identityUnavailable': 'Ahora no se puede comprobar su cuenta. Inténtelo de nuevo.',
  'form.message.signInNeeded': 'Inicie sesión para continuar.',
  'form.message.verifyNeeded': 'Confirme su dirección de correo para continuar.',
  'form.message.sessionInvalid':
    'No se pudo confirmar su inicio de sesión. Inicie sesión de nuevo.',
  'form.message.accountsUnavailable': 'Las cuentas de cliente no están disponibles.',
  'form.message.verifiedEmailMissing':
    'El correo confirmado de su cuenta no está disponible. Inicie sesión de nuevo.',
  'form.message.accountContextInvalid':
    'No se pudieron leer los datos de la cuenta en esta página. Actualice la página e inténtelo de nuevo.',
  'form.message.accountChanged': 'Su cuenta cambió. Actualice la página antes de continuar.',
  'form.message.chooseObjective': 'Elija qué desea hacer.',
  'form.message.enterMarket': 'Indique su país o mercado de destino.',
  'form.message.max120': 'Use como máximo 120 caracteres.',
  'form.message.max160': 'Use como máximo 160 caracteres.',
  'form.message.startDate': 'Indique la fecha de inicio de su visita.',
  'form.message.endDate': 'Indique la fecha de fin de su visita.',
  'form.message.endAfterStart': 'La fecha de fin no puede ser anterior a la de inicio.',
  'form.message.datesInPerson': 'Indique fechas de visita solo si estará presente en persona.',
  'form.message.tooShort': 'Escriba al menos {minimum} caracteres.',
  'form.message.tooLong': 'Use como máximo {maximum} caracteres.',
  'form.message.timezone': 'Indique una zona horaria válida.',
  'form.message.offerShort': 'Describa su oferta o necesidad con al menos 10 caracteres.',
  'form.message.website': 'Escriba una dirección web válida con http o https.',
  'form.message.websiteLong': 'Use una dirección web más corta.',
  'form.message.outcome': 'Elija al menos un resultado.',
  'form.message.name': 'Escriba su nombre.',
  'form.message.company': 'Indique su empresa.',
  'form.message.email': 'Revise la dirección de correo.',
  'form.message.testEmail': 'Use una dirección de ejemplo que termine en {domain}.',
  'form.message.quantity':
    'Escriba la cantidad como un número entero desde 1, con 12 cifras como máximo.',
  'form.message.unit': 'Indique una unidad para la cantidad.',
  'form.message.budget': 'Para el presupuesto, indique el importe, la moneda original y la base.',
  'form.message.currency': 'Elija la moneda original.',
  'form.message.amountFormat':
    'Escriba el importe original, positivo o cero, con un punto como separador decimal.',
  'form.message.decimals': '{code} admite como máximo {places} decimales. No se redondea.',
  'form.message.amountRange': 'El importe supera el rango admitido.',
  'form.message.offline':
    'No hay conexión. Sus datos siguen aquí. Inténtelo de nuevo cuando tenga conexión.',
  'form.message.offlineFirefox':
    'No hay conexión. Sus datos siguen aquí. Inténtelo de nuevo cuando tenga conexión.',
  'form.message.offlineSafari':
    'No hay conexión. Sus datos siguen aquí. Inténtelo de nuevo cuando tenga conexión.',
};
