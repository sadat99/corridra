import { describe, expect, test } from 'vitest';
import { DomainError, STEP_UP_REQUIRED, stepUpRequired } from '../../packages/domain/src/index';
import {
  formatDate,
  formatDateTime,
  formatRelativeDue,
  isoToZonedWallTime,
  timeZoneLabel,
  zonedWallTimeToIso,
} from '../../apps/web/lib/ux/format';
import {
  currencyExponent,
  currencyOptions,
  formatMoney,
  hiddenCurrencies,
  toMajorText,
  toMinor,
} from '../../apps/web/lib/ux/money';
import { countryOptions, timeZoneOptions } from '../../apps/web/lib/ux/options';
import { customerRoad, customerStatusLabel } from '../../apps/web/lib/ux/customer-road';
import { pageMetadata } from '../../apps/web/lib/ux/page-metadata';
import { safeInternalPath } from '../../apps/web/lib/ux/safe-path';
import { ActionError, readJson, withStepUp } from '../../apps/web/lib/ux/step-up';
import {
  guidedRoutePack,
  routePackConfiguration,
} from '../../packages/missions/src/route-pack-form';
import { routeConfiguration } from '../../packages/domain/src/corridors';
import { getTeamToday } from '../../packages/auth/src/team-today';
import { listDeliveredPublications } from '../../packages/delivery/src/delivered-publications';
import { notificationTypes } from '../../packages/communications/src/inbox';
import { uxSwitchNames } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// Signature and behaviour checks for the Wave 0 contracts of the commercial readiness program (5.2).
const instant = '2026-10-24T00:08:00Z';

describe('dates (D11)', () => {
  test('full form names the zone and offset and never prints ISO or US numeric dates', () => {
    expect(formatDateTime(instant, { timeZone: 'Asia/Dhaka' })).toBe(
      '24 Oct 2026, 06:08 (Dhaka, UTC+6)',
    );
    expect(formatDateTime(instant, { timeZone: 'UTC' })).toBe('24 Oct 2026, 00:08 (UTC)');
    expect(formatDate(instant, { timeZone: 'Asia/Dhaka' })).toBe('24 Oct 2026');
    const text = formatDateTime(instant, { timeZone: 'America/New_York' });
    expect(text).toBe('23 Oct 2026, 20:08 (New York, UTC-4)');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T|\d{1,2}\/\d{1,2}\/\d{2,4}/);
    expect(formatDateTime('not a date')).toBe('');
  });
  test('wall time in a zone converts to the exact instant and back', () => {
    expect(zonedWallTimeToIso('2026-10-24T06:08', 'Asia/Dhaka')).toBe('2026-10-24T00:08:00.000Z');
    expect(isoToZonedWallTime(instant, 'Asia/Dhaka')).toBe('2026-10-24T06:08');
    // Across the Madrid daylight saving change on 25 Oct 2026.
    expect(zonedWallTimeToIso('2026-10-26T10:00', 'Europe/Madrid')).toBe(
      '2026-10-26T09:00:00.000Z',
    );
    expect(zonedWallTimeToIso('', 'Asia/Dhaka')).toBeNull();
    expect(timeZoneLabel('Asia/Kolkata', new Date(instant))).toBe('Kolkata, UTC+5:30');
  });
  test('relative due wording', () => {
    const now = '2026-10-24T03:00:00Z';
    expect(formatRelativeDue('2026-10-24T09:00:00Z', now)).toBe('Due today');
    expect(formatRelativeDue('2026-10-27T09:00:00Z', now)).toMatch(/^Due in \d days$/);
    expect(formatRelativeDue('2026-10-20T09:00:00Z', now)).toMatch(/days overdue$/);
  });
});

describe('money (D10)', () => {
  test('exponents follow ISO 4217 and amounts stay exact minor units', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('BHD')).toBe(3);
    expect(currencyExponent('USD')).toBe(2);
    expect(toMinor('100', 'USD')).toBe('10000');
    expect(toMinor('100.5', 'USD')).toBe('10050');
    expect(toMinor('1,250', 'JPY')).toBe('1250');
    expect(toMinor('1.234', 'BHD')).toBe('1234');
    expect(() => toMinor('1.234', 'USD')).toThrow();
    expect(() => toMinor('1.5', 'JPY')).toThrow();
    expect(formatMoney('10000', 'USD')).toBe('USD 100.00');
    expect(formatMoney(1250, 'JPY')).toBe('JPY 1,250');
    expect(toMajorText('10050', 'USD')).toBe('100.50');
    expect(toMajorText('7', 'BHD')).toBe('0.007');
  });
  test('the currency picker pins five codes and hides fund codes', () => {
    const options = currencyOptions();
    expect(options.slice(0, 5).map((o) => o.value)).toEqual(['BDT', 'USD', 'EUR', 'CNY', 'GBP']);
    for (const code of hiddenCurrencies) expect(options.some((o) => o.value === code)).toBe(false);
    expect(options[1]!.label).toBe('US Dollar (USD)');
  });
});

describe('pickers', () => {
  test('countries start with Bangladesh, China, Spain, then the EU, labelled by name', () => {
    const options = countryOptions();
    expect(options.slice(0, 3).map((o) => o.value)).toEqual(['BD', 'CN', 'ES']);
    expect(options[0]!.label).toBe('Bangladesh');
    expect(options[3]!.hint).toBe('EU');
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });
  test('time zones start with Dhaka, Madrid, Shanghai and UTC', () => {
    const options = timeZoneOptions(new Date(instant));
    expect(options.slice(0, 4).map((o) => o.value)).toEqual([
      'Asia/Dhaka',
      'Europe/Madrid',
      'Asia/Shanghai',
      'UTC',
    ]);
    expect(options[0]!.label).toBe('Dhaka, UTC+6');
  });
});

describe('customer progress (D5, D6)', () => {
  test('a submitted request is never called a draft', () => {
    expect(customerStatusLabel('DRAFT', true).label).toBe('Received, waiting for review');
    expect(customerStatusLabel('DRAFT', false).label).toBe('Draft');
    expect(customerStatusLabel('MEETINGS', true).label).toBe('Visit');
  });
  test('the road has the six named steps', () => {
    const road = customerRoad({ status: 'TARGETING', submitted: true });
    expect(road.steps.map((s) => s.name)).toEqual([
      'Define',
      'Find',
      'Compare',
      'Visit',
      'Decide',
      'Follow through',
    ]);
    expect(road.steps.find((s) => s.step === 'find')!.state).toBe('now');
  });
});

describe('step-up (D12)', () => {
  test('the server error carries the code and the client retries once after re-verify', async () => {
    const error = stepUpRequired();
    expect(error).toBeInstanceOf(DomainError);
    expect(error.status).toBe(401);
    expect(error.code).toBe(STEP_UP_REQUIRED);
    const refused = new Response(JSON.stringify({ error: 'x', code: STEP_UP_REQUIRED }), {
      status: 401,
    });
    await expect(readJson(refused)).rejects.toMatchObject({ code: STEP_UP_REQUIRED });
    // Without a mounted dialog the action is not retried and the failure stays visible.
    let calls = 0;
    await expect(
      withStepUp(async () => {
        calls++;
        throw new ActionError('refused', 401, STEP_UP_REQUIRED);
      }),
    ).rejects.toMatchObject({ code: STEP_UP_REQUIRED });
    expect(calls).toBe(1);
    await expect(withStepUp(async () => 'done')).resolves.toBe('done');
    await expect(
      withStepUp(async () => {
        throw new ActionError('Other failure', 409);
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Other failure' });
  });
});

describe('stored links', () => {
  test('only same-site paths are followed', () => {
    expect(safeInternalPath('/account/requests/1?x=1#y')).toBe('/account/requests/1?x=1#y');
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '',
      42,
    ])
      expect(safeInternalPath(bad)).toBeNull();
  });
});

describe('page titles', () => {
  test('every page title ends with the brand once', () => {
    expect(pageMetadata('Page not found').title).toBe('Page not found | Corridra');
    expect(pageMetadata('Corridra').title).toBe('Corridra');
  });
});

describe('service contracts', () => {
  test('the guided route pack form builds a valid reviewed configuration without JSON', () => {
    const v = guidedRoutePack.parse({
      routeId: '00000000-0000-4000-8000-000000000001',
      version: 1,
      status: 'DRAFT',
      effectiveFrom: '2026-11-01T00:00:00Z',
      reason: 'QA test (madeup) route pack',
      missionTypes: ['market_entry'],
      currencies: ['EUR'],
    });
    const configuration = routePackConfiguration(v);
    expect(routeConfiguration.parse(configuration).reviewRequired).toBe(true);
    expect(configuration.channels).toEqual(['SYNTHETIC']);
  });
  test('Wave 0 stubs answer their fixed shapes', async () => {
    const pool = {} as never;
    await expect(getTeamToday(pool, {} as never)).resolves.toEqual({
      newSubmittedRequests: 0,
      overdueSubmittedRequests: 0,
      acceptedQuotesNotStarted: 0,
      repliesToReview: 0,
      meetingsNextSevenDays: 0,
    });
    await expect(listDeliveredPublications(pool, 'a'.repeat(64), 'x')).resolves.toEqual([]);
    expect(notificationTypes).toHaveLength(9);
  });
  test('the five program flags are registered and described', () => {
    const names = [
      'CORRIDRA_UX_SHELLS_V2',
      'CORRIDRA_UX_MISSIONS_V2',
      'CORRIDRA_NOTIFICATIONS_V2',
      'CORRIDRA_TEAM_INVITES',
      'CORRIDRA_ROUTE_PACK_FORM',
    ];
    for (const name of names) {
      expect(uxSwitchNames).toContain(name);
      expect(switchRegistry.some((row) => row.name === name)).toBe(true);
    }
  });
});
