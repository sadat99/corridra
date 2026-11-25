// Customer-side synthetic seed (same calls as scripts/qa/signed-in-sweep.ts) plus the staff answers to it:
// paid-service requests in every stage of the quote lifecycle, a helper profile and tasks, a supply source,
// a helper interest row and a problem report. Customer text must start with "Synthetic " (sample-mode rule).
import { randomUUID } from 'node:crypto';
const day = 86400000;
const iso = (ms) => new Date(Math.floor((Date.now() + ms) / 60000) * 60000).toISOString();
export async function seedCustomers({
  api,
  tenantId,
  standIn,
  customerContext,
  customerApi,
  resetLimits,
  problems,
  staff,
  ownerId,
  helperPrincipalId,
  reviewerId,
}) {
  const out = {
    workspaces: {},
    programmes: {},
    drafts: {},
    serviceRequests: {},
    gaps: [],
    debug: {},
  };
  const who = {};
  for (const role of ['customer', 'organiser', 'participant', 'seller']) {
    const ctx = await customerContext(standIn[role]);
    who[role] = { ctx, call: customerApi(ctx, standIn[role]), ids: {} };
  }
  const run = async (role, method, path, body, label) => {
    await resetLimits();
    const r = await who[role].call(method, path, body);
    if (!r.ok) problems.push(`${label ?? path} (${role}): ${r.status} ${r.text.slice(0, 160)}`);
    return r.ok ? (r.json ?? {}) : null;
  };
  const names = {
    customer: ['Synthetic Importers workspace', 'BUYER', 'Synthetic Importers Ltd'],
    organiser: ['Synthetic Programme office', 'ORGANISER', 'Synthetic Programme Office'],
    participant: ['Synthetic Participant workspace', 'BUYER', 'Synthetic Participant Ltd'],
    seller: ['Synthetic Exporters workspace', 'SELLER', 'Synthetic Exporters Ltd'],
  };
  for (const [role, [name, commercialRole, legalName]] of Object.entries(names)) {
    const made = await run(
      role,
      'POST',
      '/api/customer-workspaces',
      { commandId: randomUUID(), name },
      'workspace',
    );
    const workspaceId = made?.id;
    if (!workspaceId) continue;
    who[role].ids.workspaceId = out.workspaces[role] = workspaceId;
    await run(
      role,
      'POST',
      '/api/customer-organisation-profiles',
      {
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 0,
        legalName,
        countryCode: 'BD',
        website: null,
        commercialRoles: [commercialRole],
        sectors: ['Garments'],
        sizeBand: '11-50',
        summary: 'Synthetic company used only by the audit preview.',
        reason: 'Audit preview setup',
        acknowledged: true,
      },
      'organisation profile',
    );
    const draft = await run(
      role,
      'POST',
      '/api/customer-mission-drafts',
      {
        action: 'save',
        input: {
          commandId: randomUUID(),
          workspaceId,
          draftId: null,
          expectedVersion: 0,
          acknowledged: true,
          details: {
            title: 'Synthetic open request draft',
            family: 'SUPPLIERS_PRODUCTS',
            objective: 'Source suppliers',
            market: 'Bangladesh',
            attendance: 'No',
            startDate: '',
            endDate: '',
            timezone: 'Asia/Dhaka',
            offer: '',
            website: '',
            outcomes: [],
            notes: '',
            requirements: [],
            contactName: 'Synthetic Person',
            contactEmail: '',
            profileVersion: null,
            sourcingContext: 'MACHINERY',
            companyName: '',
          },
        },
      },
      'request draft',
    );
    out.drafts[role] = draft?.id ?? draft?.draftId ?? null;
  }
  // organiser programme with one accepted participant
  const programme = async (role, name) => {
    if (!who[role].ids.workspaceId) return null;
    const made = await run(
      role,
      'POST',
      '/api/customer-programmes',
      {
        commandId: randomUUID(),
        workspaceId: who[role].ids.workspaceId,
        name,
        reportingPurpose: 'Synthetic programme for the audit preview.',
        acknowledged: true,
      },
      'programme',
    );
    return (out.programmes[role] = made?.id ?? made?.programmeId ?? null);
  };
  const orgProgramme = await programme('organiser', 'Synthetic buyer programme');
  if (orgProgramme) {
    const invite = await run(
      'organiser',
      'POST',
      '/api/customer-programme-participants',
      {
        commandId: randomUUID(),
        action: 'invite',
        workspaceId: who.organiser.ids.workspaceId,
        programmeId: orgProgramme,
        label: 'Synthetic participant',
        acknowledged: true,
      },
      'participant invite',
    );
    if (invite?.token)
      await run(
        'participant',
        'POST',
        '/api/customer-programme-participants',
        {
          commandId: randomUUID(),
          action: 'accept',
          token: invite.token,
          programmeId: orgProgramme,
          displayLabel: 'Synthetic participant',
          consented: true,
        },
        'participant accept',
      );
  }
  const ownProgramme = await programme('customer', 'Synthetic buyer delegation');
  const secondProgramme = await programme('customer', 'Synthetic supplier visit programme');
  out.programmes.customerSecond = secondProgramme;
  // paid-service requests through the whole quote lifecycle
  const ws = who.customer.ids.workspaceId;
  const catalogue = ws
    ? await run(
        'customer',
        'GET',
        '/api/customer-service-requests?scope=catalogue',
        undefined,
        'service catalogue',
      )
    : null;
  const entries =
    catalogue?.services ??
    catalogue?.catalogue ??
    catalogue?.entries ??
    (Array.isArray(catalogue) ? catalogue : []);
  out.debug.catalogueKeys = catalogue ? Object.keys(catalogue) : null;
  const serviceKey = entries[0]?.key ?? entries[0]?.serviceKey;
  const staffSvc = async (body, label) => {
    const r = await api(
      'POST',
      `/api/workspace/customer-service-requests?tenant=${tenantId}`,
      body,
    );
    if (!r.ok) problems.push(`service ${label}: ${r.status} ${r.text.slice(0, 160)}`);
    return r.ok ? r.json : null;
  };
  const staffView = async (id) =>
    (
      await api(
        'GET',
        `/api/workspace/customer-service-requests?tenant=${tenantId}&scope=detail&request=${id}`,
      )
    ).json;
  const seqOf = (v) =>
    v?.lastSeq ??
    v?.seq ??
    v?.request?.seq ??
    v?.request?.lastSeq ??
    v?.expectedSeq ??
    (Array.isArray(v?.events) ? v.events.length : undefined) ??
    (Array.isArray(v?.timeline) ? v.timeline.length : undefined);
  if (ws && ownProgramme && serviceKey) {
    const plan = {
      requested: [],
      quoted: ['quote'],
      accepted: ['quote', 'accept'],
      inProgress: ['quote', 'accept', 'start'],
      delivered: ['quote', 'accept', 'start', 'deliver'],
      closed: ['quote', 'accept', 'start', 'deliver', 'close'],
      declined: ['quote', 'decline'],
    };
    for (const [i, [stage, steps]] of Object.entries(plan).entries()) {
      const made = await run(
        'customer',
        'POST',
        '/api/customer-service-requests',
        {
          action: 'create',
          commandId: randomUUID(),
          workspaceId: ws,
          contextKind: 'programme',
          contextRef: i < entries.length ? ownProgramme : (secondProgramme ?? ownProgramme),
          serviceKey: entries[i % entries.length]?.key ?? serviceKey,
          need: `Synthetic need ${i + 1}: local support during the delegation visit (${stage}).`,
          preferredFrom: null,
          preferredTo: null,
          region: 'Dhaka',
        },
        `service request ${stage}`,
      );
      const id = made?.id ?? made?.requestId;
      if (!id) continue;
      out.serviceRequests[stage] = id;
      for (const step of steps) {
        const view = await staffView(id);
        if (!out.debug.staffViewKeys)
          out.debug.staffViewKeys = view
            ? { top: Object.keys(view), request: view.request ? Object.keys(view.request) : null }
            : null;
        const expectedSeq = seqOf(view);
        if (step === 'quote') {
          await staffSvc(
            {
              action: 'quote',
              commandId: randomUUID(),
              requestId: id,
              expectedSeq,
              currency: 'EUR',
              components: [
                {
                  kind: 'service_fee',
                  label: 'Synthetic coordination fee',
                  treatment: 'included',
                  amountMinor: String(45000 + i * 5000),
                },
                {
                  kind: 'local_cost',
                  label: 'Synthetic interpreter, two days',
                  treatment: 'estimate',
                  amountMinor: '32000',
                },
                {
                  kind: 'pass_through',
                  label: 'Synthetic local transport',
                  treatment: 'not_included',
                  amountMinor: null,
                },
                {
                  kind: 'tax',
                  label: 'Synthetic tax line (none charged in the sample)',
                  treatment: 'included',
                  amountMinor: '0',
                },
              ],
              scope: 'Synthetic scope: two days of on-site coordination in Dhaka.',
              exclusions: ['Synthetic exclusion: flights and hotels'],
              assumptions: ['Synthetic assumption: visits within Dhaka city'],
              deliveryTerms: 'Synthetic delivery: within the agreed visit dates.',
              paymentTerms: 'Synthetic payment: sample only, no payment is taken.',
              validUntil: iso(10 * day),
            },
            `quote ${stage}`,
          );
        } else if (step === 'accept' || step === 'decline') {
          const detail = await run(
            'customer',
            'GET',
            `/api/customer-service-requests?scope=detail&workspaceId=${ws}&requestId=${id}`,
            undefined,
            'service detail',
          );
          const quote = detail?.quote ?? detail?.quotes?.[0];
          if (!out.debug.customerDetailKeys && detail)
            out.debug.customerDetailKeys = Object.keys(detail);
          if (step === 'accept')
            await run(
              'customer',
              'POST',
              '/api/customer-service-requests',
              {
                action: 'accept',
                commandId: randomUUID(),
                workspaceId: ws,
                requestId: id,
                quoteVersion: quote?.version,
                quoteDigest: quote?.digest,
                acknowledged: true,
              },
              `accept ${stage}`,
            );
          else
            await run(
              'customer',
              'POST',
              '/api/customer-service-requests',
              {
                action: 'decline',
                commandId: randomUUID(),
                workspaceId: ws,
                requestId: id,
                note: 'Synthetic note: the dates no longer fit.',
              },
              `decline ${stage}`,
            );
        } else {
          await staffSvc(
            {
              action: step,
              commandId: randomUUID(),
              requestId: id,
              expectedSeq,
              customerNote: `Synthetic note: ${step} recorded for the audit preview.`,
            },
            `${step} ${stage}`,
          );
        }
      }
    }
  } else out.gaps.push('service requests not seeded (no workspace, programme or catalogue entry)');
  // helper profile and tasks (execution network)
  if (helperPrincipalId && staff.sourceId) {
    const post = async (action, input, label) => {
      const r = await api('POST', `/api/workspace/${action}?tenant=${tenantId}`, input);
      if (!r.ok) problems.push(`${label}: ${r.status} ${r.text.slice(0, 160)}`);
      return r.ok ? r.json : null;
    };
    const profileId = randomUUID();
    const profile = await post(
      'network-profile',
      {
        id: profileId,
        principalId: helperPrincipalId,
        version: 1,
        alias: 'Synthetic Dhaka field helper',
        categories: ['field_researcher', 'interpreter'],
        capabilities: ['supplier_research', 'price_checks', 'site_support'],
        markets: ['BD', 'CN'],
        languages: ['en', 'bn'],
        sectors: ['machinery', 'garments'],
        workCountries: ['DE'],
        available: true,
        status: 'ACTIVE',
        eligibilitySourceId: staff.sourceId,
        expiresAt: iso(25 * day),
        reason: 'Synthetic helper profile for the audit preview',
      },
      'helper profile',
    );
    out.helperProfileId = profile ? profileId : null;
    const mission = staff.missions.quoteSent ?? staff.missions.quoting;
    if (profile && mission) {
      out.helperTasks = [];
      for (const [i, kind] of ['supplier_research', 'price_checks', 'site_support'].entries()) {
        const id = randomUUID();
        const task = await post(
          'network-task',
          {
            id,
            missionId: mission.id,
            kind,
            market: 'CN',
            workCountry: 'DE',
            location: 'Synthetic remote desk',
            language: 'en',
            sector: 'machinery',
            capabilities: [kind],
            instructions: `Synthetic task ${i + 1}: collect declared public information about the listed suppliers.`,
            deadline: iso((3 + i) * day),
            expiresAt: iso((6 + i) * day),
            evidenceRequired: 'Public source links only',
            effort: 'About two hours',
            dataHandling: 'No personal data; synthetic only',
            cancellationTerms: 'May be cancelled before acceptance',
            disputeTerms: 'Owner decides disputes',
            reviewerId: reviewerId ?? ownerId,
            rewardRuleId: null,
            reason: 'Synthetic task for the audit preview',
          },
          `helper task ${kind}`,
        );
        if (!task) continue;
        out.helperTasks.push(id);
        if (i < 2)
          await post(
            'network-event',
            {
              commandId: randomUUID(),
              taskId: id,
              version: task.version ?? 0,
              action: 'ASSIGN',
              reason: 'Synthetic assignment',
              details: {
                kind: 'assignment',
                profileId,
                relationshipDisclosure: 'No relationship with the listed suppliers declared',
              },
            },
            `helper assign ${kind}`,
          );
      }
    }
  } else out.gaps.push('helper profile and tasks not seeded (helper invitation failed)');
  // supply source (staff research)
  const src = await api('POST', `/api/supply/create-source?tenant=${tenantId}`, {
    commandId: randomUUID(),
    kind: 'staff_research',
    status: 'active',
    label: 'Synthetic trade register of Spain',
    defaultRetentionMonths: 12,
    reason: 'Synthetic source for the audit preview',
  });
  if (!src.ok) problems.push(`supply source: ${src.status} ${src.text.slice(0, 160)}`);
  out.supplySource = src.json ?? null;
  // helper interest (public form) and one problem report from the customer
  await resetLimits();
  const hi = await api('POST', '/api/helper-interest', {
    name: 'Synthetic Interested Helper',
    email: 'audit-helper-interest@example.invalid',
    country: 'BD',
    reason: 'Synthetic reason: I know the Dhaka garment suppliers well.',
    website: '',
  });
  if (!hi.ok)
    out.gaps.push(`helper interest form refused (${hi.status}): ${hi.text.slice(0, 120)}`);
  // problem reports: two from the team, one from the customer
  out.problemReports = 0;
  for (const [category, page, detail] of [
    ['did_not_work', '/operator/missions', 'Synthetic report: the filter did not keep my choice.'],
    [
      'something_else',
      '/operator/meetings',
      'Synthetic report: the meeting time shows in the wrong zone.',
    ],
  ]) {
    const r = await api('POST', `/api/workspace/problem-reports?tenant=${tenantId}`, {
      action: 'file',
      commandId: randomUUID(),
      category,
      pageKind: 'this_page',
      page,
      detail,
    });
    if (r.ok) out.problemReports += 1;
    else problems.push(`problem report (team): ${r.status} ${r.text.slice(0, 120)}`);
  }
  const pr = await run(
    'customer',
    'POST',
    '/api/customer-problem-reports',
    {
      commandId: randomUUID(),
      category: 'did_not_work',
      pageKind: 'this_page',
      page: '/account/service-requests',
      detail: 'Synthetic report: the accept button did nothing the first time.',
    },
    'problem report',
  );
  if (pr) out.problemReports += 1;
  for (const w of Object.values(who)) await w.ctx.close();
  return out;
}
