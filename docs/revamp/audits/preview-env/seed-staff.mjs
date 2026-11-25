// Synthetic staff-side seed through the app's own authenticated API (same calls as tests/operator/workspace.spec.ts).
// Every record is invented: "Synthetic ..." names and @example.invalid addresses only.
import { randomUUID } from 'node:crypto';
const day = 86400000;
const iso = (ms) => new Date(Math.floor((Date.now() + ms) / 60000) * 60000).toISOString();
function wall(instant, zone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .map((v) => [v.type, v.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export async function seedStaff({ api, tenantId, ownerId, resetLimits, log, problems }) {
  const out = {
    missions: {},
    companies: [],
    targets: [],
    meetings: [],
    opportunities: [],
    quotations: [],
    rfqs: [],
  };
  const post = async (action, input, label = action) => {
    const r = await api('POST', `/api/workspace/${action}?tenant=${tenantId}`, input);
    if (!r.ok) {
      problems.push(`${label}: ${r.status} ${r.text.slice(0, 160)}`);
      return null;
    }
    return r.json;
  };
  const get = async (action, q = '') =>
    (await api('GET', `/api/workspace/${action}?tenant=${tenantId}${q}`)).json;
  for (const key of [
    'research.ingestion',
    'communications.introductions',
    'communications.dispatch',
    'opportunities.commands',
    'ai.enabled',
    'network.enabled',
    'evidence.verification',
  ])
    await post('config', { key, enabled: true }, `config ${key}`);
  const reason = 'Synthetic audit preview seed';
  // --- reference data: templates, routes, packs
  await post('mission-templates', {});
  let cat = await get('mission-catalogue');
  const routes = {};
  for (const [origin, destination, type, currency, zone] of [
    ['BD', 'CN', 'machinery_procurement', 'CNY', 'Asia/Shanghai'],
    ['BD', 'ES', 'buyers', 'EUR', 'Europe/Madrid'],
    ['ES', 'BD', 'sourcing', 'USD', 'Asia/Dhaka'],
  ]) {
    const packId = randomUUID();
    let routeId = cat.routes.find(
      (r) => r.origin_market === origin && r.destination_market === destination,
    )?.id;
    if (!routeId) {
      routeId = randomUUID();
      await post('corridor-route', { id: routeId, origin, destination, reason });
    }
    const packVersion =
      Math.max(0, ...cat.packs.filter((p) => p.route_id === routeId).map((p) => p.version)) + 1;
    const req = cat.requirements.find((r) => r.schema?.typeKey === type) ?? cat.requirements[0];
    const ass = cat.assessments.find((r) => r.schema?.typeKey === type) ?? cat.assessments[0];
    await post(
      'corridor-pack',
      {
        id: packId,
        routeId,
        version: packVersion,
        status: 'TESTING',
        effectiveFrom: iso(-60000),
        reason,
        configuration: {
          missionTypes: [type],
          requiredCapabilities: [],
          languages: ['en'],
          currencies: [currency],
          timeZones: [zone],
          localities: [],
          clusters: [],
          requirements: req ? [req.id] : [],
          assessments: ass ? [ass.id] : [],
          sourceCategories: [],
          channels: ['SYNTHETIC'],
          jurisdictionPolicyRefs: [],
          evidenceTypes: [],
          reviewRequired: true,
          operatorCapabilities: [],
          coverage: [],
          aiPolicyRef: null,
          pricingRef: null,
        },
      },
      `corridor-pack ${origin}-${destination}`,
    );
    routes[`${origin}-${destination}`] = {
      routeId,
      packId,
      type,
      typeId: cat.types.find((t) => t.key === type)?.id,
      req,
      ass,
      currency,
      zone,
    };
  }
  // --- sources, claims, companies
  const source = await post('source', {
    kind: 'public_record',
    locator: 'https://example.invalid/audit-preview-register',
    observedAt: iso(-day),
    classification: 'PUBLIC',
    purpose: 'synthetic_validation',
    retentionUntil: iso(29 * day),
    aiPolicy: 'DENY',
  });
  if (!source) return out;
  out.sourceId = source.id;
  const companies = [
    [
      'Synthetic Ningbo Machinery Works',
      'CN',
      'Declared capacity: two filling lines per month, unverified',
    ],
    [
      'Synthetic Shenzhen Packaging Systems',
      'CN',
      'Declared export experience to South Asia, unverified',
    ],
    [
      'Synthetic Iberia Home Textiles SL',
      'ES',
      'Declared hospitality distribution in Spain, unverified',
    ],
    ['Synthetic Valencia Retail Group', 'ES', 'Declared 40 retail outlets, unverified'],
    [
      'Synthetic Dhaka Knit Exporters Ltd',
      'BD',
      'Declared knitwear capacity of 200000 pieces per month, unverified',
    ],
    [
      'Synthetic Chattogram Agro Traders',
      'BD',
      'Declared demand for two combine harvesters, unverified',
    ],
    [
      'Synthetic Madrid Trade Institute',
      'ES',
      'Declared institutional buyer programme, unverified',
    ],
    ['Synthetic Guangzhou Tooling Co', 'CN', 'Declared tooling lead time of 45 days, unverified'],
  ];
  const co = [];
  for (const [i, [name, country, statement]] of companies.entries()) {
    const claim = await post('claim', { sourceId: source.id, statement });
    const org = await post(
      'research',
      {
        action: 'ingest',
        commandId: randomUUID(),
        sourceId: source.id,
        name,
        country,
        domain: `audit-co-${i + 1}.example.invalid`,
        address: `Synthetic address ${i + 1}`,
        identifierType: 'registry',
        identifier: randomUUID(),
      },
      `ingest ${name}`,
    );
    if (!org || !claim) continue;
    await post('research', {
      action: 'attribute',
      commandId: randomUUID(),
      organisationId: org.id,
      kind: 'capability',
      claimId: claim.id,
      validUntil: iso(25 * day),
    });
    const rel = await post('research', {
      action: 'relationship',
      commandId: randomUUID(),
      organisationId: org.id,
      ownerId,
      visibility: 'OWNER',
      note: 'Synthetic relationship for the audit preview',
    });
    const contact =
      rel &&
      (await post('research', {
        action: 'contact',
        commandId: randomUUID(),
        relationshipId: rel.id,
        sourceId: source.id,
        name: `Synthetic Contact ${i + 1}`,
        jobTitle: 'Commercial coordinator',
        email: `audit-contact-${i + 1}@example.invalid`,
        validUntil: iso(25 * day),
      }));
    co.push({
      id: org.id,
      name,
      country,
      claimId: claim.id,
      relationshipId: rel?.id,
      contactId: contact?.id,
    });
  }
  out.companies = co;
  // --- missions through the public sample intake
  const briefs = [
    [
      'new',
      'Source suppliers',
      'China',
      'Synthetic Agro Importers Ltd',
      'Synthetic request for two rice milling lines',
      [],
    ],
    [
      'new2',
      'Find customers or distributors',
      'Spain',
      'Synthetic Jute Crafts Ltd',
      'Synthetic jute homeware looking for Spanish distributors',
      [],
    ],
    [
      'qualification',
      'Sell in a new market',
      'Spain',
      'Synthetic Knit Exports Ltd',
      'Synthetic knitted sweaters for Spanish retailers',
      ['qualify'],
    ],
    [
      'active',
      'Source suppliers',
      'China',
      'Synthetic Beverage Co',
      'Synthetic bottling line procurement for a juice plant',
      ['qualify', 'activate'],
    ],
    [
      'quoting',
      'Source suppliers',
      'China',
      'Synthetic Packaging Buyers Ltd',
      'Synthetic carton packaging machine procurement',
      ['qualify', 'activate', 'targeting'],
    ],
    [
      'quoteSent',
      'Source suppliers',
      'China',
      'Synthetic Tooling Importers',
      'Synthetic injection moulding tooling request',
      ['qualify', 'activate', 'targeting', 'outreach'],
    ],
    [
      'meetings',
      'Sell in a new market',
      'Spain',
      'Synthetic Home Textiles BD',
      'Synthetic hotel towels for Spanish hospitality buyers',
      ['qualify', 'activate', 'targeting', 'outreach', 'meetings'],
    ],
    [
      'followUp',
      'Make an upcoming business trip more productive',
      'Spain',
      'Synthetic Leather Goods BD',
      'Synthetic leather accessories buyer trip to Madrid',
      ['qualify', 'activate', 'targeting', 'outreach', 'meetings', 'followup'],
    ],
    [
      'pipeline',
      'Find customers or distributors',
      'Spain',
      'Synthetic Ceramics BD',
      'Synthetic tableware for Spanish retail chains',
      ['qualify', 'activate', 'targeting', 'outreach', 'meetings', 'followup', 'pipeline'],
    ],
    [
      'closed',
      'Sell in a new market',
      'Spain',
      'Synthetic Denim Mills BD',
      'Synthetic denim fabric for Spanish brands',
      ['qualify', 'activate', 'targeting', 'outreach', 'meetings', 'followup', 'pipeline', 'close'],
    ],
    [
      'onHold',
      'Source suppliers',
      'China',
      'Synthetic Solar Importers',
      'Synthetic solar pump components sourcing',
      ['qualify', 'activate', 'pause'],
    ],
    [
      'cancelled',
      'Run a multi-company mission',
      'Spain',
      'Synthetic Exporters Association',
      'Synthetic ten company delegation to Barcelona',
      ['qualify', 'cancel'],
    ],
  ];
  const m = {};
  const step = async (key, action) => {
    const x = m[key];
    const done = await post(
      'mission',
      {
        id: x.id,
        version: x.version,
        commandId: randomUUID(),
        action,
        reason,
        ownerId,
        nextAction: {
          qualify: 'Confirm the scope with the requester',
          activate: 'Assign a route and start research',
          targeting: 'Shortlist counterparties',
          outreach: 'Send approved introductions',
          meetings: 'Confirm the meeting schedule',
          followup: 'Collect meeting outcomes',
          pipeline: 'Track the commercial pipeline',
          close: 'Archive the mission record',
          pause: 'Wait for the requester',
          cancel: 'No further action',
        }[action],
        dueAt: iso((key === 'active' ? 0.0007 : 3 + Math.random() * 10) * day),
        marketCode: x.market === 'China' ? 'CN' : 'ES',
        targetProfile:
          x.market === 'China'
            ? 'Synthetic machinery suppliers'
            : 'Synthetic Spanish buyers and distributors',
      },
      `mission ${key} ${action}`,
    );
    if (!done) return false;
    x.version += 1;
    x.status = action;
    return true;
  };
  const advance = async (key, upTo) => {
    const x = m[key];
    while (x?.later?.length && x.later[0] !== undefined) {
      const action = x.later[0];
      if (!(await step(key, action))) return false;
      x.later.shift();
      if (action === upTo) break;
    }
    return true;
  };
  for (const [key, objective, market, company, offer, steps] of briefs) {
    await resetLimits();
    const visit = objective.startsWith('Make');
    const r = await api('POST', '/api/intake', {
      key: randomUUID(),
      websiteCheck: '',
      brief: {
        objective,
        market,
        attendance: visit ? 'Yes' : 'No',
        startDate: visit ? iso(20 * day).slice(0, 10) : '',
        endDate: visit ? iso(24 * day).slice(0, 10) : '',
        timezone: market === 'China' ? 'Asia/Dhaka' : 'Europe/Madrid',
        offer,
        website: '',
        outcomes: [market === 'China' ? 'Supplier visits' : 'Relevant meetings'],
        notes: 'Synthetic audit preview only',
        name: `Synthetic ${key} Person`,
        company,
        email: `audit-${key.toLowerCase()}@example.invalid`,
        acknowledged: true,
      },
    });
    if (!r.ok) {
      problems.push(`intake ${key}: ${r.status} ${r.text.slice(0, 120)}`);
      continue;
    }
    m[key] = { id: r.json.id, company, market, version: 1 };
    m[key].later = steps.slice(3);
    for (const action of steps.slice(0, 3)) if (!(await step(key, action))) break;
  }
  out.missions = m;
  // --- route assignment, targets
  const assign = async (key, routeKey) => {
    if (!m[key]) return null;
    const rt = routes[routeKey],
      id = randomUUID();
    const ok = await post(
      'mission-route',
      { id, missionId: m[key].id, packId: rt.packId, missionTypeId: rt.typeId, version: 1, reason },
      `mission-route ${key}`,
    );
    if (ok) ((m[key].assignmentId = id), (m[key].route = rt));
    return ok;
  };
  const targetFor = async (key, c, fit = 'POSSIBLE') => {
    if (!m[key] || !c?.relationshipId) return null;
    const t = await post(
      'research',
      {
        action: 'target',
        commandId: randomUUID(),
        missionId: m[key].id,
        relationshipId: c.relationshipId,
        contactId: c.contactId,
        claimIds: [c.claimId],
        fit,
        rationale: 'Declared capability may fit the synthetic requirement',
        uncertainty: 'Nothing independently verified',
        gaps: 'Need documents and references',
        nextAction: 'Review the declared information',
        dueAt: iso(5 * day),
      },
      `target ${key} ${c.name}`,
    );
    if (t) ((m[key].targets ??= []).push({ id: t.id, company: c }), out.targets.push(t.id));
    return t;
  };
  const cn = co.filter((c) => c.country === 'CN'),
    es = co.filter((c) => c.country === 'ES');
  for (const key of ['quoting', 'quoteSent', 'active', 'onHold']) await assign(key, 'BD-CN');
  for (const key of ['meetings', 'followUp', 'pipeline', 'closed', 'qualification'])
    await assign(key, 'BD-ES');
  for (const key of ['quoting', 'quoteSent']) for (const c of cn) await targetFor(key, c);
  for (const key of ['meetings', 'followUp', 'pipeline', 'closed'])
    for (const c of es) await targetFor(key, c, 'STRONG');
  // --- requirements, assessment, RFQ, quotations (money lines) on the two sourcing missions
  for (const key of ['quoting', 'quoteSent']) {
    const x = m[key];
    if (!x?.assignmentId || !x.targets?.length) continue;
    const c0 = x.targets[0].company,
      prov = { sourceId: source.id, claimId: c0.claimId };
    await post(
      'commercial-mission',
      {
        commandId: randomUUID(),
        missionId: x.id,
        reason,
        ...prov,
        action: 'requirements',
        assignmentId: x.assignmentId,
        definitionId: x.route.req.id,
        version: 1,
        schemaVersion: 1,
        declaration: 'Synthetic importer declaration recorded for the audit preview',
        fields: {
          objective: 'Procure a machine against declared requirements',
          role: 'IMPORTER',
          product:
            key === 'quoting'
              ? 'Synthetic carton packaging machine'
              : 'Synthetic injection moulding tooling',
          quantity: '2',
          unit: 'machines',
          budgetMinor: '48000000',
          currency: 'CNY',
          budgetBasis: 'Total for two machines',
          incoterm: 'FOB',
          leadTime: 'Within 90 days',
          machinery: { capacity: 'One hundred pieces per hour', utilities: '380 V three phase' },
        },
      },
      `requirements ${key}`,
    );
    const snap = await get('commercial-mission', `&mission=${x.id}`);
    const requirementId = snap?.requirements?.[0]?.id;
    if (!requirementId) {
      problems.push(`requirements ${key}: none read back`);
      continue;
    }
    x.requirementId = requirementId;
    for (const t of x.targets.slice(0, 2))
      await post(
        'commercial-mission',
        {
          commandId: randomUUID(),
          missionId: x.id,
          reason,
          sourceId: source.id,
          claimId: t.company.claimId,
          action: 'assessment',
          requirementId,
          definitionId: x.route.ass.id,
          targetId: t.id,
          version: 1,
          method: 'Desk review of declared information',
          observedAt: iso(-3600000),
          results: (x.route.ass.schema?.criteria ?? ['machinery_fit', 'supplier_fit']).map(
            (criterion) => ({
              criterion,
              result: 'UNKNOWN',
              requirement: 'Declared machine capacity and supplier fit',
              basis: 'Supplier declaration only; no documents reviewed',
            }),
          ),
          technicalResults: (x.route.ass.schema?.machineryFields ?? []).map((field) => ({
            field,
            result: 'UNKNOWN',
            basis: 'Not supplied by the supplier yet',
          })),
          unknowns: 'Utilities and installation remain unknown',
          gaps: 'Request technical documentation and references',
          rationale: 'Discuss requirements before any supplier selection',
        },
        `assessment ${key}`,
      );
    const rfq = await post(
      'commercial-mission',
      {
        commandId: randomUUID(),
        missionId: x.id,
        reason,
        ...prov,
        action: 'rfq',
        requirementId,
        targetIds: x.targets.map((t) => t.id),
        buyerContext: 'Synthetic importer machinery request',
        requestedTerms: 'Unit price, tooling, lead time, Incoterm and warranty',
        dueAt: iso(7 * day),
      },
      `rfq ${key}`,
    );
    if (!rfq) continue;
    out.rfqs.push(rfq.id);
    x.rfqId = rfq.id;
    const prices = [
      ['118000000', '4500000'],
      ['126500000', '3000000'],
      ['109900000', '6000000'],
    ];
    for (const [i, t] of x.targets.slice(0, key === 'quoting' ? 1 : 3).entries()) {
      const q = await post(
        'commercial-mission',
        {
          commandId: randomUUID(),
          missionId: x.id,
          reason,
          sourceId: source.id,
          claimId: t.company.claimId,
          action: 'quotation',
          rfqId: rfq.id,
          targetId: t.id,
          revision: 1,
          currency: 'CNY',
          terms: {
            specification: 'Synthetic machine to the declared specification',
            quantity: '2',
            unit: 'machines',
            unitPriceMinor: prices[i][0],
            totalPriceMinor: String(BigInt(prices[i][0]) * 2n),
            toolingMinor: prices[i][1],
            leadTime: `${60 + i * 15} days after deposit`,
            validUntil: iso(20 * day),
            incoterm: 'FOB',
            shipping: 'EXCLUDED',
            warranty: '12 months on parts',
            installation: 'Remote support only',
            paymentTerms: '30 percent deposit, balance before shipment',
          },
          uncertainties: 'Installation scope and spare parts list not supplied',
          observedAt: iso(-1800000),
        },
        `quotation ${key} ${i}`,
      );
      if (q) (out.quotations.push(q.id), (x.quotationIds ??= []).push(q.id));
    }
    if (key === 'quoteSent' && x.quotationIds?.length) {
      const assessmentId = (await get('commercial-mission', `&mission=${x.id}`))?.assessments?.find(
        (a) => a.target_id === x.targets[0].id,
      )?.id;
      if (assessmentId)
        await post(
          'commercial-mission',
          {
            commandId: randomUUID(),
            missionId: x.id,
            reason,
            ...prov,
            action: 'decision',
            requirementId,
            targetId: x.targets[0].id,
            assessmentId,
            quotationId: x.quotationIds[0],
            decision: 'NEED_INFORMATION',
            rationale: 'Lowest price but installation scope is missing',
            nextAction: 'Ask for the installation scope',
            ownerId,
            dueAt: iso(4 * day),
          },
          'decision quoteSent',
        );
    }
  }
  // --- approved introductions (sample channel), dispatch, recipient answers through the public reply API
  const intros = [];
  const pol = {},
    tpl = await post('communication', {
      action: 'template',
      commandId: randomUUID(),
      name: 'Synthetic approved introduction',
      contactPurpose: 'official_company_channel',
      body: 'Would a short conversation about the declared requirement be useful?',
    });
  for (const j of ['CN', 'ES'])
    pol[j] = await post(
      'communication',
      {
        action: 'policy',
        commandId: randomUUID(),
        jurisdiction: j,
        channel: 'SYNTHETIC',
        contactPurpose: 'official_company_channel',
        basis: 'Invented policy for the audit preview only. No real legal basis asserted.',
        validUntil: iso(20 * day),
        enabled: true,
      },
      `policy ${j}`,
    );
  for (const key of ['quoteSent', 'meetings', 'followUp', 'pipeline', 'closed'])
    for (const t of m[key]?.targets ?? []) {
      if (!tpl || !pol[t.company.country]) continue;
      const intro = await post(
        'communication',
        {
          action: 'introduce',
          commandId: randomUUID(),
          targetId: t.id,
          contactId: t.company.contactId,
          policyId: pol[t.company.country].id,
          templateId: tpl.id,
          expiresAt: iso(6 * day),
          introduction: {
            company: m[key].company,
            country: 'BD',
            capability: 'Synthetic declared capability',
            fit: 'Declared requirement may fit',
            evidence: 'Self-declared only; nothing independently verified',
            uncertainty: 'Capacity and demand are unverified',
            conversationPurpose: 'Compare declared requirements',
            availableDates: 'Dates by agreement',
          },
        },
        `introduce ${key} ${t.company.name}`,
      );
      if (intro) (intros.push({ key, t, intro }), (t.intro = intro));
    }
  await post('dispatch', {});
  let comms = null;
  for (let i = 0; i < 60; i++) {
    comms = await get('communications');
    const mine = comms?.messages ?? [];
    if (mine.length >= intros.length && mine.every((x) => x.delivery_status === 'DELIVERED')) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  out.introductions = intros.length;
  out.introductionsDelivered = (comms?.messages ?? []).filter(
    (x) => x.delivery_status === 'DELIVERED',
  ).length;
  const decisions = ['INTERESTED', 'INTERESTED', 'INTERESTED'];
  for (const [i, x] of intros.entries()) {
    const token = /[a-f0-9]{64}/.exec(x.intro.buyerPath ?? '')?.[0];
    const decision =
      x.key === 'quoteSent' ? ['INTERESTED', 'NEED_INFO', 'NOT_RELEVANT'][i % 3] : decisions[i % 3];
    if (!token) {
      problems.push('introduction without a reply token');
      continue;
    }
    await resetLimits();
    const r = await api('POST', '/api/buyer', {
      action: 'respond',
      token,
      responseId: randomUUID(),
      decision,
      optOut: false,
    });
    if (!r.ok) problems.push(`buyer respond ${x.key}: ${r.status} ${r.text.slice(0, 120)}`);
    x.t.decision = decision;
    x.t.messageId =
      x.intro.messageId ?? (comms?.messages ?? []).find((mm) => mm.target_id === x.t.id)?.id;
    (out.replyLinks ??= []).push(x.intro.buyerPath);
  }
  out.introSample = intros[0]?.intro;
  out.messageSample = comms?.messages?.[0];
  for (const key of ['quoteSent', 'meetings', 'followUp', 'pipeline', 'closed'])
    await advance(key, 'outreach');
  // --- meetings: past (held, no-show, cancelled) and upcoming (scheduled, accepted, proposed)
  const meet = async (key, t, kind, title, path) => {
    const made = await post(
      'meeting',
      {
        commandId: randomUUID(),
        ownerId,
        nextAction: 'Confirm the meeting',
        dueAt: iso(2 * day),
        ...(t.messageId
          ? { action: 'propose', messageId: t.messageId }
          : {
              action: 'proposeActivity',
              targetId: t.id,
              activityKind: kind,
              context: {
                purpose: 'Compare declared requirements with the synthetic offer',
                checklist: ['Bring product samples', 'Confirm decision maker attends'],
                evidenceRequests: ['Company registration extract'],
              },
            }),
        title,
        brief: 'Synthetic meeting brief written for the audit preview only.',
        participants: ['Synthetic exporter representative', t.company.name + ' buyer'],
        reason,
      },
      `meeting ${title}`,
    );
    if (!made) return;
    let version = made.version ?? 1;
    const rec = { id: made.id, missionId: m[key].id, title, status: 'PROPOSED' };
    out.meetings.push(rec);
    for (const [status, extra] of path) {
      const r = await post(
        'meeting',
        {
          commandId: randomUUID(),
          ownerId,
          nextAction: 'Follow the meeting plan',
          dueAt: iso(2 * day),
          action: 'transition',
          id: made.id,
          version,
          status,
          reason,
          ...extra,
        },
        `meeting ${title} -> ${status}`,
      );
      if (!r) break;
      version = r.version ?? version + 1;
      rec.status = status;
    }
    rec.version = version;
  };
  const sched = (offsetDays, hours = 1, location = 'Synthetic meeting room, Madrid') => {
    const startsAt = iso(offsetDays * day),
      endsAt = new Date(Date.parse(startsAt) + hours * 3600000).toISOString();
    return {
      schedule: {
        startsAt,
        endsAt,
        timezone: 'Europe/Madrid',
        localStart: wall(startsAt, 'Europe/Madrid'),
        localEnd: wall(endsAt, 'Europe/Madrid'),
        location,
      },
    };
  };
  const acc = { acceptance: 'Synthetic counterparty accepted by recorded phone call' };
  const mt = (key, i) => m[key]?.targets?.[i];
  const plans = [
    [
      'meetings',
      0,
      'BUYER_MEETING',
      'Synthetic buyer meeting with Iberia Home Textiles',
      [
        ['ACCEPTED', acc],
        ['SCHEDULED', sched(2)],
      ],
    ],
    [
      'meetings',
      1,
      'SHOWROOM_VISIT',
      'Synthetic showroom visit at Valencia Retail Group',
      [
        ['ACCEPTED', acc],
        ['SCHEDULED', sched(5, 2, 'Synthetic showroom, Valencia')],
      ],
    ],
    [
      'meetings',
      2,
      'INSTITUTIONAL_MEETING',
      'Synthetic briefing at Madrid Trade Institute',
      [['ACCEPTED', acc]],
    ],
    [
      'followUp',
      0,
      'BUYER_MEETING',
      'Synthetic leather accessories buyer meeting',
      [
        ['ACCEPTED', acc],
        ['SCHEDULED', sched(-6)],
        ['HELD', { outcome: 'Buyer asked for a sample set and a price list in EUR.' }],
      ],
    ],
    [
      'followUp',
      1,
      'TRADE_FAIR_MEETING',
      'Synthetic trade fair stand meeting',
      [
        ['ACCEPTED', acc],
        ['SCHEDULED', sched(-4)],
        ['NO_SHOW', { outcome: 'The counterparty did not attend and sent no notice.' }],
      ],
    ],
    ['followUp', 2, 'BUYER_MEETING', 'Synthetic follow-up call proposal', []],
    [
      'pipeline',
      0,
      'BUYER_MEETING',
      'Synthetic tableware range review',
      [
        ['ACCEPTED', acc],
        ['SCHEDULED', sched(-12)],
        ['HELD', { outcome: 'Buyer requested a trial order proposal for 2000 sets.' }],
      ],
    ],
    [
      'pipeline',
      1,
      'BUYER_MEETING',
      'Synthetic retail chain introduction',
      [
        ['ACCEPTED', acc],
        ['SCHEDULED', sched(-10)],
        ['HELD', { outcome: 'Chain will review listing fees; proposal requested.' }],
      ],
    ],
    [
      'pipeline',
      2,
      'INSTITUTIONAL_MEETING',
      'Synthetic institute briefing (cancelled)',
      [
        ['ACCEPTED', acc],
        ['CANCELLED', {}],
      ],
    ],
    [
      'closed',
      0,
      'BUYER_MEETING',
      'Synthetic denim buyer meeting',
      [
        ['ACCEPTED', acc],
        ['SCHEDULED', sched(-30)],
        ['HELD', { outcome: 'Buyer placed a declared trial order.' }],
      ],
    ],
    ['closed', 1, 'BUYER_MEETING', 'Synthetic denim second buyer (declined)', [['DECLINED', {}]]],
  ];
  for (const [key, i, kind, title, path] of plans)
    if (mt(key, i)) await meet(key, mt(key, i), kind, title, path);
  for (const key of ['meetings', 'followUp', 'pipeline', 'closed']) await advance(key, 'followup');
  // --- opportunities and money records from held meetings (a record comes before the stage that needs it)
  const keyOf = (missionId) => Object.keys(m).find((k) => m[k].id === missionId);
  const held = out.meetings.filter((x) => x.status === 'HELD');
  const opp = async (input, label) =>
    post('opportunity', { commandId: randomUUID(), reason, ...input }, label);
  const owned = { ownerId, nextAction: 'Advance the opportunity', dueAt: iso(6 * day) };
  for (const [i, h] of held.entries()) {
    const o = await opp(
      {
        ...owned,
        action: 'create',
        meetingId: h.id,
        title: `Synthetic opportunity: ${h.title}`.slice(0, 150),
        attribution: 'Declared outcome of a held synthetic meeting',
      },
      `opportunity ${i}`,
    );
    if (!o) continue;
    const rec = {
      id: o.id,
      missionKey: keyOf(h.missionId),
      status: 'LEAD',
      version: o.version ?? 1,
      records: 0,
    };
    out.opportunities.push(rec);
    const r = await opp(
      {
        ...owned,
        action: 'transition',
        id: o.id,
        version: rec.version,
        status: 'QUALIFIED_OPPORTUNITY',
      },
      `opportunity ${i} qualify`,
    );
    if (r) ((rec.version = r.version ?? rec.version + 1), (rec.status = 'QUALIFIED_OPPORTUNITY'));
  }
  for (const key of ['pipeline', 'closed']) await advance(key, 'pipeline');
  const kinds = {
    PROPOSAL: ['PROPOSAL', '1850000'],
    COMMITMENT: ['COMMITMENT', '1800000'],
    CONTRACT: ['CONTRACT', '1800000'],
    INVOICE: ['INVOICE', '1800000'],
    CASH_COLLECTED: ['CASH_RECEIPT', '1800000'],
  };
  const all = Object.keys(kinds);
  let nth = 0;
  for (const rec of out.opportunities) {
    if (rec.status !== 'QUALIFIED_OPPORTUNITY') continue;
    const path =
      rec.missionKey === 'closed'
        ? all
        : rec.missionKey === 'pipeline'
          ? [all.slice(0, 2), all.slice(0, 4), ['LOST']][nth++ % 3]
          : [];
    let parentId;
    for (const status of path) {
      if (kinds[status]) {
        const done = await opp(
          {
            action: 'record',
            id: rec.id,
            kind: kinds[status][0],
            sourceId: source.id,
            occurredAt: iso(-(8 - all.indexOf(status)) * 3600000),
            summary: `Synthetic ${kinds[status][0].toLowerCase().replace('_', ' ')} declared by the exporter`,
            externalReference: `AUDIT-${kinds[status][0]}-${rec.id.slice(0, 8)}`,
            amountMinor: kinds[status][1],
            currency: 'EUR',
            ...(parentId ? { parentId } : {}),
          },
          `record ${kinds[status][0]}`,
        );
        if (!done) break;
        parentId = done.id;
        rec.records += 1;
        if (status === 'CASH_COLLECTED')
          await opp(
            {
              action: 'confirm',
              recordId: done.id,
              sourceId: source.id,
              occurredAt: iso(-3600000),
              basis: 'Synthetic bank statement line matched by the owner',
            },
            'confirm cash',
          );
      }
      const r = await opp(
        {
          ...owned,
          action: 'transition',
          id: rec.id,
          version: rec.version,
          status,
          ...(status === 'LOST' ? { lossReason: 'Buyer chose an existing supplier' } : {}),
        },
        `opportunity -> ${status}`,
      );
      if (!r) break;
      rec.version = r.version ?? rec.version + 1;
      rec.status = status;
    }
  }
  // --- close: every follow-up of the closed mission is completed first
  const ms = await get('meetings');
  for (const f of ms?.followups ?? []) {
    const mtg = out.meetings.find((x) => x.id === f.meeting_id);
    if (!mtg || keyOf(mtg.missionId) !== 'closed' || f.status !== 'OPEN') continue;
    await post(
      'meeting',
      {
        commandId: randomUUID(),
        action: 'followup',
        id: f.id,
        version: f.version,
        status: 'COMPLETED',
        reason: 'Synthetic follow-up completed for the audit preview',
      },
      'followup complete',
    );
  }
  out.followupSample = ms?.followups?.[0];
  for (const key of ['closed']) await advance(key, 'close');
  // --- reports: approved mission publications, one client progress link and one evidence request
  const delivery = async (action, input, label) =>
    post('delivery', { action, input: { commandId: randomUUID(), ...input } }, label);
  out.publications = {};
  for (const key of ['followUp', 'pipeline', 'closed']) {
    if (!m[key]) continue;
    const mine = out.meetings.filter((x) => x.missionId === m[key].id && x.status === 'HELD');
    const opps = out.opportunities.filter((o) => o.missionKey === key).map((o) => o.id);
    const pub = await delivery(
      'publication',
      {
        missionId: m[key].id,
        title: `Synthetic progress report: ${m[key].company}`.slice(0, 150),
        company: m[key].company,
        objective: 'Review synthetic meeting outcomes and next steps',
        brief:
          'Synthetic report text written for the audit preview. Only explicitly approved synthetic records are included.',
        nextAction: 'Review the open follow-ups',
        dueAt: iso(7 * day),
        meetings: mine.map((x) => ({ id: x.id, version: x.version, label: x.title.slice(0, 150) })),
        opportunityIds: opps,
        includeFinancials: key !== 'followUp',
        approved: true,
      },
      `publication ${key}`,
    );
    if (pub) out.publications[key] = pub.id;
  }
  if (out.publications.pipeline) {
    const share = await delivery(
      'share',
      {
        programmeId: null,
        publicationIds: [out.publications.pipeline],
        audience: 'CLIENT_PROGRESS',
        purpose: 'Synthetic client progress link for the audit preview',
        expiresAt: iso(6 * day),
        allowExport: false,
        includeDelegation: false,
        approved: true,
      },
      'share',
    );
    out.clientProgressPath = share?.path ?? share?.clientPath ?? share?.url ?? null;
    out.shareKeys = share ? Object.keys(share) : null;
    await delivery(
      'request',
      {
        publicationId: out.publications.pipeline,
        ownerId,
        title: 'Synthetic evidence request: signed order form',
        instructions: 'Synthetic instruction: describe the signed order form in your own words.',
        dueAt: iso(5 * day),
      },
      'evidence request',
    );
  }
  for (const x of Object.values(m)) delete x.later;
  return out;
}
