import { z } from 'zod';
import { DomainError } from './index';
import { currencies } from './currencies';
import { currency, minorUnits } from './opportunities';
import { missionCatalogue, requirementFields } from './commercial-missions';
import { storedTextOctets, unstorable, type RouteConfiguration } from './corridors';
import { hasContactShape, supplySourceKinds } from './supply-sources';

// ADR-093 Route Pack Standard v1 (decisions B to G). One standard for every route: the locked part stays the guarded pack
// configuration, and the standard content is a separate append-only document per route. Every rule about that content lives
// here: the field registry, the document schema, completeness, the shared go-live check and the carry-over of unset pack
// keys. Pure, zod only, so a page may import it; the server re-checks on every write and is the authority. No section, field
// or branch names a country. v1 is frozen once built: a later standard adds a new registry beside this one.
export const routePackStandardVersion = 1 as const;
const routePackContentOctetBudget = 131072;
export const routePackSections = [
  { number: 1, name: 'Identity and scope' },
  { number: 2, name: 'Missions' },
  { number: 3, name: 'Languages, money and time' },
  { number: 4, name: 'Market map' },
  { number: 5, name: 'Trade fairs and events' },
  { number: 6, name: 'Trade and customs' },
  { number: 7, name: 'Standards and certification' },
  { number: 8, name: 'Documents' },
  { number: 9, name: 'Logistics' },
  { number: 10, name: 'Payments' },
  { number: 11, name: 'Travel' },
  { number: 12, name: 'Compliance and outreach' },
  { number: 13, name: 'Sourcing profile' },
  { number: 14, name: 'Supply sources' },
  { number: 15, name: 'Partners and coverage' },
  { number: 16, name: 'Risks and watch' },
  { number: 17, name: 'Custom fields and notes' },
] as const;
export const sectionNumber = z.int().min(1).max(17);
export type SectionNumber = z.infer<typeof sectionNumber>;
export const factTypes = ['text', 'number', 'money', 'date', 'choice', 'list', 'link'] as const;
export type FactType = (typeof factTypes)[number];
export type PackStatus = 'DRAFT' | 'TESTING' | 'LIMITED' | 'ACTIVE' | 'PAUSED';
export const liveStatuses = ['LIMITED', 'ACTIVE'] as const;

// One row of the field dictionary (docs/adr/0093/route-pack-standard-v1-fields.csv). label, format and help are the CSV words
// verbatim. maxLength bounds a text value as a whole and each item of a list or link. configurationKey is set for the 12
// `pack.` rows only: their value is the locked pack key of the same name.
export type StandardField = {
  key: string;
  section: SectionNumber;
  label: string;
  part: 'Locked' | 'Content';
  core: boolean;
  type: FactType;
  format: string;
  help: string;
  minLength?: number;
  maxLength: number;
  maxItems?: number;
  allowed?: readonly string[];
  itemPattern?: RegExp;
  configurationKey?: Exclude<keyof RouteConfiguration, 'sourcing'>;
};
const packKey = /^[a-z][a-z0-9_.-]{0,79}$/;
const httpsAddress = /^https:\/\/\S+$/;
const missionKeys = missionCatalogue.map((mission) => mission.key);
const currencyCodes = Object.keys(currencies);
const incoterms = requirementFields.shape.incoterm.unwrap().options;
export const standardFieldsV1: readonly StandardField[] = [
  {
    key: 'identity.display_name',
    section: 1,
    label: 'Route name',
    part: 'Content',
    core: true,
    type: 'text',
    format: '3 to 120 characters',
    help: 'The name the team sees for this route. Origin first, then destination.',
    minLength: 3,
    maxLength: 120,
  },
  {
    key: 'identity.summary',
    section: 1,
    label: 'What this route is for',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'One or two sentences: who on which side wants what.',
    maxLength: 300,
  },
  {
    key: 'identity.service_coverage',
    section: 1,
    label: 'What we can do here today',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Be exact about what the team can deliver now and what it cannot. A country you can pick is not a promise of service there.',
    maxLength: 1000,
  },
  {
    key: 'identity.origin_scope',
    section: 1,
    label: 'Origin area covered',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'The part of the origin country or bloc we serve, if not all of it.',
    maxLength: 300,
  },
  {
    key: 'identity.destination_scope',
    section: 1,
    label: 'Destination area covered',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'For a bloc such as the EU, name the member countries we cover first.',
    maxLength: 300,
  },
  {
    key: 'identity.out_of_scope',
    section: 1,
    label: 'Not covered',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Things a customer may expect that we do not do on this route.',
    maxLength: 1000,
  },
  {
    key: 'pack.missionTypes',
    section: 2,
    label: 'Missions offered',
    part: 'Locked',
    core: true,
    type: 'list',
    format:
      'One or more of: buyers, customers, distributors, partners, sourcing, machinery_procurement, supplier_evaluation, meetings, factory_visits, trade_fairs, business_trips, market_validation, market_entry, export_market_access, delegations',
    help: 'The kinds of work a customer can start on this route. This sets what the route allows, so it goes into the locked pack.',
    maxLength: 80,
    maxItems: 50,
    allowed: missionKeys,
    configurationKey: 'missionTypes',
  },
  {
    key: 'missions.eligibility_notes',
    section: 2,
    label: 'Who can use these missions',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Plain rules about which customers we accept for each mission.',
    maxLength: 1000,
  },
  {
    key: 'missions.typical_timeline',
    section: 2,
    label: 'Usual time to a first result',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'What a customer can expect. Write a range, not a promise.',
    maxLength: 300,
  },
  {
    key: 'pack.languages',
    section: 3,
    label: 'Working languages',
    part: 'Locked',
    core: true,
    type: 'list',
    format: 'Language tags (BCP 47), up to 30',
    help: 'Languages the team and the parties use on this route.',
    maxLength: 80,
    maxItems: 30,
    configurationKey: 'languages',
  },
  {
    key: 'pack.currencies',
    section: 3,
    label: 'Currencies used',
    part: 'Locked',
    core: true,
    type: 'list',
    format: 'ISO 4217 codes, up to 30',
    help: 'Currencies that quotes and records on this route may use.',
    maxLength: 3,
    maxItems: 30,
    allowed: currencyCodes,
    configurationKey: 'currencies',
  },
  {
    key: 'pack.timeZones',
    section: 3,
    label: 'Time zones',
    part: 'Locked',
    core: true,
    type: 'list',
    format: 'IANA time zone names, up to 30',
    help: 'Time zones of both sides, used to plan meetings.',
    maxLength: 80,
    maxItems: 30,
    configurationKey: 'timeZones',
  },
  {
    key: 'locale.working_week',
    section: 3,
    label: 'Working week on each side',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'Which days businesses usually work on each side.',
    maxLength: 300,
  },
  {
    key: 'locale.closure_periods',
    section: 3,
    label: 'Long closures',
    part: 'Content',
    core: true,
    type: 'list',
    format: 'One closure per row or separated by |; set valid until to the end of the year',
    help: 'Periods when most business stops for days, so meetings, samples and shipments slip. Write Not applicable with a reason if there are none.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'locale.public_holidays',
    section: 3,
    label: 'Public holidays this year',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'YYYY-MM-DD Holiday name, one per row or separated by |',
    help: 'Single public holidays on either side. Set valid until to the end of the year.',
    maxLength: 1000,
    maxItems: 100,
    itemPattern: /^\d{4}-\d{2}-\d{2} \S/,
  },
  {
    key: 'locale.business_hours',
    section: 3,
    label: 'Usual business hours',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'Local hours, so the team proposes meeting times that suit both sides.',
    maxLength: 300,
  },
  {
    key: 'market.priority_sectors',
    section: 4,
    label: 'Priority sectors',
    part: 'Content',
    core: true,
    type: 'list',
    format: 'One sector per row or separated by |',
    help: 'The sectors we focus on first on this route.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'market.counterpart_types',
    section: 4,
    label: 'Companies we look for',
    part: 'Content',
    core: true,
    type: 'list',
    format: 'One type per row or separated by |',
    help: 'The kinds of companies we find for customers on the other side, such as buyers, suppliers or distributors.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'market.key_cities',
    section: 4,
    label: 'Key cities and regions',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'One place per row or separated by |',
    help: 'Places where most of the companies we need are.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'market.clusters',
    section: 4,
    label: 'Industrial clusters',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Place: what is made there',
    help: 'Known production or trading clusters, one per row.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'market.notes',
    section: 4,
    label: 'Market notes',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Anything else about the market that helps the team.',
    maxLength: 1000,
  },
  {
    key: 'pack.localities',
    section: 4,
    label: 'Place keys',
    part: 'Locked',
    core: false,
    type: 'list',
    format:
      'Short keys: lowercase letters, digits, _ . - (up to 80 characters each, up to 50 keys)',
    help: 'Short keys a mission can be narrowed to. Leave Pending if unsure; an empty list changes nothing.',
    maxLength: 80,
    maxItems: 50,
    itemPattern: packKey,
    configurationKey: 'localities',
  },
  {
    key: 'pack.clusters',
    section: 4,
    label: 'Cluster keys',
    part: 'Locked',
    core: false,
    type: 'list',
    format:
      'Short keys: lowercase letters, digits, _ . - (up to 80 characters each, up to 50 keys)',
    help: 'Short keys a mission can be narrowed to. Leave Pending if unsure.',
    maxLength: 80,
    maxItems: 50,
    itemPattern: packKey,
    configurationKey: 'clusters',
  },
  {
    key: 'events.trade_fairs',
    section: 5,
    label: 'Trade fairs',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'One fair per row: name; city; months; link',
    help: 'Fairs worth visiting or exhibiting at on this route. Set valid until when dates are announced for one year only.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'events.other_events',
    section: 5,
    label: 'Other events and missions',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'One event per row: name; city; months; link',
    help: 'Buyer meets, government trade missions, chamber events.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'events.planning_lead_time',
    section: 5,
    label: 'How early to plan',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'How far ahead a customer must start to take part.',
    maxLength: 300,
  },
  {
    key: 'trade.restricted_goods',
    section: 6,
    label: 'Restricted or banned goods',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 1000 characters; add the official list in source',
    help: 'We never take a mission for these goods without checking first.',
    maxLength: 1000,
  },
  {
    key: 'trade.hs_focus',
    section: 6,
    label: 'HS codes we focus on',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'HS codes, 2 to 6 digits, separated by |',
    help: 'Customs codes of the goods we deal with most. 8452 is sewing machines; 5208 is woven cotton fabric.',
    maxLength: 1000,
    maxItems: 100,
    itemPattern: /^\d{2,6}$/,
  },
  {
    key: 'trade.duty_notes',
    section: 6,
    label: 'Import duties and taxes',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Where to find the duty and tax for a product, and anything that often surprises customers.',
    maxLength: 1000,
  },
  {
    key: 'trade.preferences',
    section: 6,
    label: 'Trade preferences',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Lower duty schemes that may apply and what they require.',
    maxLength: 1000,
  },
  {
    key: 'trade.rules_of_origin',
    section: 6,
    label: 'Rules of origin',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'When goods count as made in a country, and the certificate needed.',
    maxLength: 1000,
  },
  {
    key: 'trade.licences',
    section: 6,
    label: 'Licences and permits',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Import or export licences either side may need.',
    maxLength: 1000,
  },
  {
    key: 'trade.customs_link',
    section: 6,
    label: 'Official customs site',
    part: 'Content',
    core: false,
    type: 'link',
    format: 'https:// address',
    help: 'The official customs or tariff site for the destination.',
    maxLength: 1000,
  },
  {
    key: 'standards.required_certifications',
    section: 7,
    label: 'Certifications that are asked for',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Certificate: when it is needed, one per row',
    help: 'Certificates the law or usual buyers ask for on this route.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'standards.testing_bodies',
    section: 7,
    label: 'Testing and inspection',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Organisation names, one per row',
    help: 'Labs or inspection firms customers often use. Organisations only, no personal details.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'standards.labelling',
    section: 7,
    label: 'Labelling and marking',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Language, marks and labels goods must carry.',
    maxLength: 1000,
  },
  {
    key: 'documents.required_by_mission',
    section: 8,
    label: 'Documents for each mission',
    part: 'Content',
    core: true,
    type: 'list',
    format: 'One mission per row: mission key: documents, separated by commas',
    help: 'The documents a customer will usually need, so nothing is a surprise.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'documents.notes',
    section: 8,
    label: 'Document notes',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Attestation, translation or original copies that are needed.',
    maxLength: 1000,
  },
  {
    key: 'pack.evidenceTypes',
    section: 8,
    label: 'Evidence type keys',
    part: 'Locked',
    core: false,
    type: 'list',
    format:
      'Short keys: lowercase letters, digits, _ . - (up to 80 characters each, up to 50 keys)',
    help: 'Kinds of evidence the route expects. Leave Pending if unsure.',
    maxLength: 80,
    maxItems: 50,
    itemPattern: packKey,
    configurationKey: 'evidenceTypes',
  },
  {
    key: 'logistics.main_ports',
    section: 9,
    label: 'Main seaports',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Port names, one per row or separated by |',
    help: 'Seaports goods usually move through on this route.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'logistics.airports',
    section: 9,
    label: 'Main cargo airports',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Airport name and code',
    help: 'Airports used for samples and urgent goods.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'logistics.usual_modes',
    section: 9,
    label: 'Usual transport',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Any of: sea, air, road, rail, courier',
    help: 'How goods and samples usually travel.',
    maxLength: 1000,
    maxItems: 100,
    allowed: ['sea', 'air', 'road', 'rail', 'courier'],
  },
  {
    key: 'logistics.transit_times',
    section: 9,
    label: 'Usual transit times',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 300 characters',
    help: 'A range for each mode. Not a promise.',
    maxLength: 300,
  },
  {
    key: 'logistics.incoterms_common',
    section: 9,
    label: 'Common Incoterms',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Any of: EXW, FCA, CPT, CIP, DAP, DPU, DDP, FAS, FOB, CFR, CIF',
    help: 'Terms quotes usually use here. A hint only, never a term on an offer.',
    maxLength: 1000,
    maxItems: 100,
    allowed: incoterms,
  },
  {
    key: 'logistics.notes',
    section: 9,
    label: 'Logistics notes',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Forwarders, inland transport, warehouse or clearance notes.',
    maxLength: 1000,
  },
  {
    key: 'payments.norms',
    section: 10,
    label: 'Usual payment terms',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'How deals on this route are usually paid, so a customer can judge an offer.',
    maxLength: 1000,
  },
  {
    key: 'payments.instruments',
    section: 10,
    label: 'Payment methods in use',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'One method per row or separated by |',
    help: 'Bank transfer, letter of credit or other methods that are common here.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'payments.banking_notes',
    section: 10,
    label: 'Banking and exchange rules',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Rules on sending or receiving foreign currency that affect deals.',
    maxLength: 1000,
  },
  {
    key: 'payments.fx_source',
    section: 10,
    label: 'Exchange rate source',
    part: 'Content',
    core: false,
    type: 'link',
    format: 'https:// address',
    help: 'The rate page the team uses when it shows a converted amount. Conversions stay derived; the original amount is never replaced.',
    maxLength: 1000,
  },
  {
    key: 'travel.business_visa',
    section: 11,
    label: 'Business visa',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 1000 characters; add the official page in source',
    help: 'What a customer needs to visit the other side for business. Write Not applicable with a reason if this route has no travel.',
    maxLength: 1000,
  },
  {
    key: 'travel.invitation_letter',
    section: 11,
    label: 'Invitation letter',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Whether an invitation letter is needed and who may issue it.',
    maxLength: 1000,
  },
  {
    key: 'travel.visa_lead_time_days',
    section: 11,
    label: 'Days to get a visa',
    part: 'Content',
    core: false,
    type: 'number',
    format: 'Whole days',
    help: 'Usual days from applying to having the visa.',
    maxLength: 4,
    itemPattern: /^(0|[1-9]\d{0,3})$/,
  },
  {
    key: 'travel.visit_notes',
    section: 11,
    label: 'Visit notes',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Factory visit habits, meeting customs, what to bring.',
    maxLength: 1000,
  },
  {
    key: 'travel.travel_advice',
    section: 11,
    label: 'Official travel advice',
    part: 'Content',
    core: false,
    type: 'link',
    format: 'https:// address',
    help: 'The official travel advice page for visitors.',
    maxLength: 1000,
  },
  {
    key: 'pack.channels',
    section: 12,
    label: 'Message channels',
    part: 'Locked',
    core: true,
    type: 'list',
    format: 'Any of: SYNTHETIC, MANUAL (no other value)',
    help: 'SYNTHETIC means sample messages only. MANUAL means the team sends by hand. Real email sending is decided elsewhere, not here.',
    maxLength: 9,
    maxItems: 2,
    allowed: ['SYNTHETIC', 'MANUAL'],
    configurationKey: 'channels',
  },
  {
    key: 'compliance.privacy_laws',
    section: 12,
    label: 'Privacy laws',
    part: 'Content',
    core: true,
    type: 'list',
    format: 'Law name for each side, one per row',
    help: 'The data protection laws that apply to people we contact on this route.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'compliance.outreach_rules',
    section: 12,
    label: 'Rules for first contact',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'May we write to a company that did not ask us? What must a first message say? How do people opt out?',
    maxLength: 1000,
  },
  {
    key: 'compliance.sanctions_check',
    section: 12,
    label: 'Sanctions and export controls',
    part: 'Content',
    core: true,
    type: 'text',
    format: 'Up to 1000 characters; add the official list in source',
    help: 'Which lists the team checks before work on this route, and goods that need an export control check.',
    maxLength: 1000,
  },
  {
    key: 'compliance.anti_bribery_note',
    section: 12,
    label: 'Gifts and anti-bribery',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'Rules on gifts, hospitality and agent payments.',
    maxLength: 1000,
  },
  {
    key: 'sourcing.profile',
    section: 13,
    label: 'Sourcing profile',
    part: 'Locked',
    core: false,
    type: 'text',
    format:
      'Leave value empty. Filled is shown by the system when the pack carries a sourcing profile',
    help: 'The buying workflow profile from ADR-083. It is entered through the pack, not this sheet. Write Not applicable with a reason for routes where customers do not buy, or leave Pending.',
    maxLength: 0,
  },
  {
    key: 'supply.planned_source_kinds',
    section: 14,
    label: 'Where companies come from',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Any of: staff_research, partner_organisation, partner_person, data_platform',
    help: 'A plan only. Which sources are open is decided by the supply source controls, not by this row.',
    maxLength: 1000,
    maxItems: 100,
    allowed: supplySourceKinds,
  },
  {
    key: 'supply.public_sources',
    section: 14,
    label: 'Public sources we use',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'One https:// address per row',
    help: 'Public registers and directories the team searches.',
    maxLength: 1000,
    maxItems: 100,
    itemPattern: httpsAddress,
  },
  {
    key: 'pack.sourceCategories',
    section: 14,
    label: 'Source category keys',
    part: 'Locked',
    core: false,
    type: 'list',
    format:
      'Short keys: lowercase letters, digits, _ . - (up to 80 characters each, up to 50 keys)',
    help: 'Kinds of source a mission on this route may use. Leave Pending if unsure.',
    maxLength: 80,
    maxItems: 50,
    itemPattern: packKey,
    configurationKey: 'sourceCategories',
  },
  {
    key: 'partners.local_partners',
    section: 15,
    label: 'Local partner organisations',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'Organisation names, one per row',
    help: 'Only organisations that agreed to be listed. No names of people, emails or phone numbers.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'partners.interpreting',
    section: 15,
    label: 'Interpreting and translation',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 1000 characters',
    help: 'How we cover languages in meetings and documents.',
    maxLength: 1000,
  },
  {
    key: 'pack.coverage',
    section: 15,
    label: 'Coverage keys',
    part: 'Locked',
    core: false,
    type: 'list',
    format:
      'Short keys: lowercase letters, digits, _ . - (up to 80 characters each, up to 50 keys)',
    help: 'Where the team can deliver. Leave Pending if unsure.',
    maxLength: 80,
    maxItems: 50,
    itemPattern: packKey,
    configurationKey: 'coverage',
  },
  {
    key: 'pack.requiredCapabilities',
    section: 15,
    label: 'Required capability keys',
    part: 'Locked',
    core: false,
    type: 'list',
    format:
      'Short keys: lowercase letters, digits, _ . - (up to 80 characters each, up to 50 keys)',
    help: 'Capabilities that must be ready before a mission runs here. Leave Pending if unsure.',
    maxLength: 80,
    maxItems: 50,
    itemPattern: packKey,
    configurationKey: 'requiredCapabilities',
  },
  {
    key: 'pack.operatorCapabilities',
    section: 15,
    label: 'Team capability keys',
    part: 'Locked',
    core: false,
    type: 'list',
    format:
      'Short keys: lowercase letters, digits, _ . - (up to 80 characters each, up to 50 keys)',
    help: 'Skills the team must have for this route. Leave Pending if unsure.',
    maxLength: 80,
    maxItems: 50,
    itemPattern: packKey,
    configurationKey: 'operatorCapabilities',
  },
  {
    key: 'risks.key_risks',
    section: 16,
    label: 'Main risks for customers',
    part: 'Content',
    core: true,
    type: 'list',
    format: 'Risk: what we do about it, one per row',
    help: 'The risks a customer should know, such as quality, payment or fraud patterns.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'risks.watch_items',
    section: 16,
    label: 'Things to re-check',
    part: 'Content',
    core: false,
    type: 'list',
    format: 'One item per row; set valid until',
    help: 'Rules, rates or dates that change often. Each row turns stale after its valid until date.',
    maxLength: 1000,
    maxItems: 100,
  },
  {
    key: 'notes.general',
    section: 17,
    label: 'Free notes',
    part: 'Content',
    core: false,
    type: 'text',
    format: 'Up to 4000 characters',
    help: 'Anything about this route that has no field yet.',
    maxLength: 4000,
  },
];
export const standardFieldByKey: ReadonlyMap<string, StandardField> = new Map(
  standardFieldsV1.map((field) => [field.key, field]),
);
export const coreKeysV1: readonly string[] = standardFieldsV1
  .filter((field) => field.core)
  .map((field) => field.key);
// The 12 locked pack keys the sheet and the guided form may set. The other 6 configuration keys are never set from a file:
// references chosen on the screen, pricingRef that stays null and reviewRequired that stays true.
export const sheetLockedKeys = [
  'missionTypes',
  'languages',
  'currencies',
  'timeZones',
  'localities',
  'clusters',
  'evidenceTypes',
  'channels',
  'sourceCategories',
  'coverage',
  'requiredCapabilities',
  'operatorCapabilities',
] as const;
export type SheetLockedKey = (typeof sheetLockedKeys)[number];

const expiredPoliciesNote = ' Expired policies removed: ';
const sectionNameList = routePackSections
  .map((section) => `${section.number} ${section.name}`)
  .join(', ');
export const routePackWords = {
  unknownKey: (key: string) =>
    `${key} is not a field of Route Pack Standard v1. Custom fields start with custom.`,
  keyShape:
    'Use a field key of Route Pack Standard v1, or a custom key that starts with custom. and uses lowercase letters, digits and _.',
  repeatedKey: (key: string) => `${key} is given more than once. Keep one fact per field.`,
  notApplicableNote: 'Not applicable needs a reason in the note.',
  source: 'A filled fact needs a source: an https:// address or the words staff knowledge.',
  email:
    'Remove the email address. Route content names organisations, places and rules, never people.',
  unstorable: 'Remove the characters the database cannot store.',
  tooLarge: 'This route content is too large to save. Shorten notes or long lists.',
  coreNotApplicable: (key: string) =>
    `${key} is needed before the route may go live, so it cannot be Not applicable.`,
  lockedCoreFilled: (key: string) =>
    `${key} is a locked pack setting the route needs before it may go live. Set it in the pack; the content does not hold it.`,
  lockedFilled: (key: string) =>
    `${key} belongs to the locked pack. Set it in the pack; content may only mark it Not applicable.`,
  lockedDetails: (key: string) =>
    `${key} belongs to the locked pack, so it takes no value, source or dates.`,
  observedOn: (key: string) =>
    `${key} needs the date it was observed, written YYYY-MM-DD and not in the future.`,
  validUntil: (key: string) => `${key} needs a valid until date on or after the observed date.`,
  value: (key: string, needs: string) => `${key} needs ${needs}.`,
  customDefinition: (key: string) => `${key} needs a label, a section and a type.`,
  customChoice: (key: string) => `${key} is a choice, so it needs its allowed values.`,
  customAllowed: (key: string) =>
    `${key} takes allowed values only when its type is choice or list.`,
  standardDefinition: (key: string) =>
    `${key} is a standard field, so it takes no label, section, type or allowed values.`,
  tooManyCustom: 'A route may hold at most 100 custom fields.',
  listSeparator: (key: string) =>
    `${key}: a list value or an allowed value cannot contain the | sign, because the sheet uses it to separate values.`,
  repeatedSection: 'Mark each section Not applicable once.',
  sectionName: `Name the section by its number or name: ${sectionNameList}.`,
  customKeyConflict: (key: string) =>
    `${key} already means something else on another route: use the same section, type and allowed values, or a new key.`,
  contentChanged: "This route's content changed since you opened it. Reload and try again.",
  commandReused: 'Command key reused with different values',
  policyExpired: (names: string) =>
    `These policies have expired: ${names}. Pause the route, or publish with a current policy.`,
  expiredPoliciesRemoved: (names: string) => `${expiredPoliciesNote}${names}.`,
  packChanged: "This route's pack changed since you opened it. Reload and try again.",
  proposalTooLarge: 'This route pack is too large to review. Shorten long lists.',
  notPublished:
    'The proposal was saved but not published. Send the same request again to publish it.',
  goLivePendingCore: (labels: string) => `These Core fields are still Pending: ${labels}.`,
  coreTurnsPending: (labels: string) =>
    `These Core fields are now Pending on a live route: ${labels}.`,
  lockedCoreEmptied: (labels: string) =>
    `The route is live, so these fields cannot be emptied: ${labels}.`,
  notFound: 'Not found',
} as const;

const staffKnowledge = 'staff knowledge';
export const factSource = z.union([
  z.literal(staffKnowledge),
  z.url({ protocol: /^https$/ }).max(1000),
]);
export const moneyValue = z.object({ currency, amountMinor: minorUnits }).strict();
export const contentFact = z
  .object({
    key: z
      .string()
      .regex(/^(custom\.[a-z][a-z0-9_]{0,59}|[a-z]+\.[A-Za-z_]+)$/, routePackWords.keyShape),
    state: z.enum(['FILLED', 'NOT_APPLICABLE']),
    // A number is a canonical decimal string; money is exact minor units in its own currency, never converted.
    value: z.union([z.string(), z.array(z.string()).max(100), moneyValue]).optional(),
    source: factSource.optional(),
    observedOn: z.iso.date().optional(),
    validUntil: z.iso.date().optional(),
    note: z.string().trim().max(1000).optional(),
    // Custom facts only.
    label: z.string().trim().min(1).max(120).optional(),
    section: sectionNumber.optional(),
    type: z.enum(factTypes).optional(),
    allowedValues: z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional(),
  })
  .strict();
export type ContentFact = z.infer<typeof contentFact>;
const sectionMark = z
  .object({ section: sectionNumber, note: z.string().trim().min(3).max(1000) })
  .strict();
export const contentDocumentV1 = z
  .object({
    standardVersion: z.literal(1),
    sectionMarks: z.array(sectionMark).max(17),
    facts: z.array(contentFact).max(500),
  })
  .strict()
  .superRefine(documentRulesV1);
export type ContentDocument = z.infer<typeof contentDocumentV1>;
export const emptyContentDocument: ContentDocument = {
  standardVersion: 1,
  sectionMarks: [],
  facts: [],
};

type ValueRule = Pick<
  StandardField,
  'key' | 'type' | 'minLength' | 'maxLength' | 'maxItems' | 'allowed' | 'itemPattern'
>;
const canonicalNumber = /^-?(0|[1-9]\d{0,14})(\.\d{0,5}[1-9])?$/;
const httpsUrl = z.url({ protocol: /^https$/ });
function itemFits(rule: ValueRule, item: string) {
  return (
    item.trim().length > 0 &&
    item.length <= rule.maxLength &&
    (!rule.allowed || rule.allowed.includes(item)) &&
    (!rule.itemPattern || rule.itemPattern.test(item))
  );
}
// What a Filled value of this type needs, or null when the value is right.
function valueNeeds(rule: ValueRule, value: ContentFact['value']): string | null {
  const text = typeof value === 'string' ? value : null;
  switch (rule.type) {
    case 'text': {
      const min = Math.max(rule.minLength ?? 1, 1);
      return text !== null && text.trim().length >= min && text.length <= rule.maxLength
        ? null
        : `text of ${min} to ${rule.maxLength} characters`;
    }
    case 'number':
      return text !== null &&
        canonicalNumber.test(text) &&
        text !== '-0' &&
        (!rule.itemPattern || rule.itemPattern.test(text))
        ? null
        : rule.itemPattern
          ? 'a whole number'
          : 'a number such as 12 or 12.5';
    case 'money':
      return moneyValue.safeParse(value).success
        ? null
        : 'a currency code and an exact amount in minor units';
    case 'date':
      return text !== null && z.iso.date().safeParse(text).success
        ? null
        : 'a date written YYYY-MM-DD';
    case 'choice':
      return text !== null && itemFits(rule, text)
        ? null
        : `one of: ${(rule.allowed ?? []).join(', ')}`;
    case 'link':
      return text !== null && text.length <= rule.maxLength && httpsUrl.safeParse(text).success
        ? null
        : 'an https:// address';
    case 'list':
      return Array.isArray(value) &&
        value.length > 0 &&
        value.length <= (rule.maxItems ?? 100) &&
        value.every((item) => itemFits(rule, item))
        ? null
        : rule.allowed
          ? `1 to ${rule.maxItems ?? 100} values, each one of: ${rule.allowed.join(', ')}`
          : `1 to ${rule.maxItems ?? 100} values of up to ${rule.maxLength} characters each`;
  }
}
function textsOf(fact: ContentFact): string[] {
  const value = fact.value;
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return [
    ...values,
    ...[fact.note, fact.source, fact.label].filter((text) => text !== undefined),
    ...(fact.allowedValues ?? []),
  ];
}
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
function documentRulesV1(document: ContentDocument, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });
  const today = todayUtc();
  const seenSections = new Set<number>();
  document.sectionMarks.forEach((mark, index) => {
    if (seenSections.has(mark.section))
      issue(['sectionMarks', index], routePackWords.repeatedSection);
    seenSections.add(mark.section);
    if (hasContactShape(mark.note, { phone: false }))
      issue(['sectionMarks', index], routePackWords.email);
    if (unstorable.test(mark.note)) issue(['sectionMarks', index], routePackWords.unstorable);
  });
  const seenKeys = new Set<string>();
  let customCount = 0;
  document.facts.forEach((fact, index) => {
    const path = ['facts', index];
    const custom = fact.key.startsWith('custom.');
    if (seenKeys.has(fact.key)) issue(path, routePackWords.repeatedKey(fact.key));
    seenKeys.add(fact.key);
    const texts = textsOf(fact);
    if (texts.some((text) => hasContactShape(text, { phone: false })))
      issue(path, routePackWords.email);
    if (texts.some((text) => unstorable.test(text))) issue(path, routePackWords.unstorable);
    if (
      [...(Array.isArray(fact.value) ? fact.value : []), ...(fact.allowedValues ?? [])].some(
        (item) => item.includes('|'),
      )
    )
      issue(path, routePackWords.listSeparator(fact.key));
    if (fact.state === 'NOT_APPLICABLE' && (fact.note ?? '').length < 3)
      issue(path, routePackWords.notApplicableNote);
    const defined =
      fact.label !== undefined ||
      fact.section !== undefined ||
      fact.type !== undefined ||
      fact.allowedValues !== undefined;
    let rule: ValueRule;
    if (custom) {
      customCount++;
      if (fact.label === undefined || fact.section === undefined || fact.type === undefined) {
        issue(path, routePackWords.customDefinition(fact.key));
        return;
      }
      if (fact.type === 'choice' && !fact.allowedValues)
        issue(path, routePackWords.customChoice(fact.key));
      if (fact.allowedValues && fact.type !== 'choice' && fact.type !== 'list')
        issue(path, routePackWords.customAllowed(fact.key));
      rule = {
        key: fact.key,
        type: fact.type,
        maxLength: 1000,
        maxItems: 100,
        allowed: fact.allowedValues,
      };
    } else {
      const field = standardFieldByKey.get(fact.key);
      if (!field) {
        issue(path, routePackWords.unknownKey(fact.key));
        return;
      }
      if (defined) issue(path, routePackWords.standardDefinition(fact.key));
      if (field.part === 'Locked') {
        if (field.core)
          issue(
            path,
            fact.state === 'FILLED'
              ? routePackWords.lockedCoreFilled(fact.key)
              : routePackWords.coreNotApplicable(fact.key),
          );
        else if (fact.state === 'FILLED') issue(path, routePackWords.lockedFilled(fact.key));
        if (
          fact.value !== undefined ||
          fact.source !== undefined ||
          fact.observedOn !== undefined ||
          fact.validUntil !== undefined
        )
          issue(path, routePackWords.lockedDetails(fact.key));
        return;
      }
      rule = field;
    }
    if (fact.state !== 'FILLED') return;
    const needs = valueNeeds(rule, fact.value);
    if (needs) issue(path, routePackWords.value(fact.key, needs));
    if (fact.source === undefined) issue(path, routePackWords.source);
    if (fact.observedOn === undefined || fact.observedOn > today)
      issue(path, routePackWords.observedOn(fact.key));
    else if (fact.validUntil !== undefined && fact.validUntil < fact.observedOn)
      issue(path, routePackWords.validUntil(fact.key));
  });
  if (customCount > 100) issue(['facts'], routePackWords.tooManyCustom);
  if (storedTextOctets(document) > routePackContentOctetBudget) issue([], routePackWords.tooLarge);
}

// Every issue of a document, each with the fact key it belongs to (the word `section` for a section mark, null for the whole
// document), so the sheet can name the row.
export function contentDocumentIssues(input: unknown): { key: string | null; message: string }[] {
  const result = contentDocumentV1.safeParse(input);
  if (result.success) return [];
  const facts =
    input && typeof input === 'object' && Array.isArray((input as { facts?: unknown }).facts)
      ? ((input as { facts: unknown[] }).facts as unknown[])
      : [];
  return result.error.issues.map((issue) => {
    const [area, index] = issue.path;
    let key: string | null = null;
    if (area === 'sectionMarks') key = 'section';
    if (area === 'facts' && typeof index === 'number') {
      const fact = facts[index];
      const factKey =
        fact && typeof fact === 'object' ? (fact as { key?: unknown }).key : undefined;
      key = typeof factKey === 'string' ? factKey : null;
    }
    return { key, message: issue.message };
  });
}
export function parseContentDocument(input: unknown): ContentDocument {
  const result = contentDocumentV1.safeParse(input);
  if (result.success) return result.data;
  const first = contentDocumentIssues(input)[0];
  throw new DomainError(first?.message ?? 'Check the route content', 400, 'ROUTE_PACK_INVALID');
}
// A section named by its number or its name, as the sheet allows; null when it names none.
export function sectionFromName(text: string): SectionNumber | null {
  const trimmed = text.trim();
  const section = routePackSections.find(
    (s) => String(s.number) === trimmed || s.name.toLowerCase() === trimmed.toLowerCase(),
  );
  return section ? section.number : null;
}

// Completeness (ADR-093 C). Every standard row and every custom fact of the route has one state.
export type FieldState = 'FILLED' | 'NOT_APPLICABLE' | 'PENDING';
// Tolerant of a legacy pack: a key that is absent reads as not set.
export type PackView = { status: PackStatus; configuration: Partial<RouteConfiguration> } | null;
export type FieldRow = {
  key: string;
  section: SectionNumber;
  part: 'Locked' | 'Content';
  core: boolean;
  custom: boolean;
  state: FieldState;
  coveredBySection: boolean;
  stale: boolean;
};
export type SectionState = {
  section: SectionNumber;
  name: string;
  state: FieldState;
  pendingLockedCore: string[];
};
export type Completeness = {
  standardVersion: 1;
  fields: FieldRow[];
  sections: SectionState[];
  pendingCore: string[];
  staleCore: string[];
  pendingOptionalCount: number;
};
function lockedState(field: StandardField, pack: PackView, fact: ContentFact | undefined) {
  const configuration = pack?.configuration ?? {};
  const filled = field.configurationKey
    ? (() => {
        const value = configuration[field.configurationKey];
        return Array.isArray(value) && value.length > 0;
      })()
    : configuration.sourcing !== undefined;
  if (filled) return 'FILLED';
  // A Locked Core row is never Not applicable; the schema refuses the mark, and a stray one is ignored here.
  return !field.core && fact?.state === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'PENDING';
}
export function deriveCompleteness(
  pack: PackView,
  document: ContentDocument | null,
  today: string,
): Completeness {
  const facts = new Map((document?.facts ?? []).map((fact) => [fact.key, fact]));
  const marked = new Set((document?.sectionMarks ?? []).map((mark) => mark.section));
  const rows: FieldRow[] = [];
  const add = (
    base: Omit<FieldRow, 'state' | 'coveredBySection' | 'stale'>,
    own: FieldState,
    fact: ContentFact | undefined,
  ) => {
    const lockedCore = base.part === 'Locked' && base.core;
    const coveredBySection = own !== 'FILLED' && marked.has(base.section) && !lockedCore;
    const stale =
      own === 'FILLED' &&
      base.part === 'Content' &&
      fact?.validUntil !== undefined &&
      fact.validUntil < today;
    rows.push({
      ...base,
      state: coveredBySection ? 'NOT_APPLICABLE' : own,
      coveredBySection,
      stale,
    });
  };
  for (const field of standardFieldsV1) {
    const fact = facts.get(field.key);
    const base = {
      key: field.key,
      section: field.section,
      part: field.part,
      core: field.core,
      custom: false,
    };
    add(
      base,
      field.part === 'Locked' ? lockedState(field, pack, fact) : (fact?.state ?? 'PENDING'),
      fact,
    );
  }
  const customs = [...facts.values()]
    .flatMap((fact) =>
      fact.key.startsWith('custom.') && fact.section !== undefined
        ? [{ fact, section: fact.section }]
        : [],
    )
    .sort((a, b) => a.section - b.section || a.fact.key.localeCompare(b.fact.key));
  for (const { fact, section } of customs)
    add({ key: fact.key, section, part: 'Content', core: false, custom: true }, fact.state, fact);
  const sections = routePackSections.map((section): SectionState => {
    const inSection = rows.filter((row) => row.section === section.number);
    const lockedCoreOpen = inSection
      .filter((row) => row.part === 'Locked' && row.core && row.state !== 'FILLED')
      .map((row) => row.key);
    const notApplicable =
      marked.has(section.number) ||
      (inSection.length > 0 && inSection.every((row) => row.state === 'NOT_APPLICABLE'));
    let state: FieldState;
    if (notApplicable) state = lockedCoreOpen.length ? 'PENDING' : 'NOT_APPLICABLE';
    else
      state =
        inSection.every((row) => !row.core || row.state !== 'PENDING') &&
        inSection.some((row) => row.state === 'FILLED')
          ? 'FILLED'
          : 'PENDING';
    return {
      section: section.number,
      name: section.name,
      state,
      pendingLockedCore: state === 'PENDING' ? lockedCoreOpen : [],
    };
  });
  return {
    standardVersion: 1,
    fields: rows,
    sections,
    pendingCore: rows.filter((row) => row.core && row.state === 'PENDING').map((row) => row.key),
    staleCore: rows.filter((row) => row.core && row.stale).map((row) => row.key),
    pendingOptionalCount: rows.filter((row) => !row.core && row.state === 'PENDING').length,
  };
}

// The one go-live check (ADR-093 C, owner 27 Nov 2026 "confirm warn only"), judged on the pack and content as they are after
// the write. It refuses one thing: on a route that is LIMITED or ACTIVE and stays so, a pack version that empties a Filled
// Locked Core row (a pack list such as languages or channels set to []). It warns, and never refuses, of two others: a move
// to LIMITED or ACTIVE while a Core field is Pending, and, on a live route, a version that turns a Core field Pending. Moving
// to PAUSED, DRAFT or TESTING is never held back nor warned of.
export type GoLiveInput = {
  before: { pack: PackView; document: ContentDocument | null };
  after: { pack: PackView; document: ContentDocument | null };
};
export const goLiveWarningCodes = [
  'ROUTE_PACK_GO_LIVE_PENDING_CORE',
  'ROUTE_PACK_CORE_TURNS_PENDING',
] as const;
export type GoLiveWarning = { code: (typeof goLiveWarningCodes)[number]; keys: string[] };
export type GoLiveResult =
  | { ok: true; warnings: GoLiveWarning[] }
  | { ok: false; code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED'; keys: string[] };
const isLive = (status: PackStatus | undefined) =>
  (liveStatuses as readonly (PackStatus | undefined)[]).includes(status);
const passes = (warning?: GoLiveWarning): GoLiveResult => ({
  ok: true,
  warnings: warning?.keys.length ? [warning] : [],
});
export function goLiveCheck(input: GoLiveInput): GoLiveResult {
  const after = input.after.pack?.status;
  if (!isLive(after)) return passes();
  const today = todayUtc();
  const afterView = deriveCompleteness(input.after.pack, input.after.document, today);
  const beforeView = deriveCompleteness(input.before.pack, input.before.document, today);
  const before = input.before.pack?.status;
  // A Locked Core row is Filled or Pending only, and only the pack sets it, so a content version never empties one.
  if (isLive(before)) {
    const filledBefore = new Set(
      beforeView.fields.filter((row) => row.state === 'FILLED').map((row) => row.key),
    );
    const emptied = afterView.fields
      .filter(
        (row) =>
          row.part === 'Locked' && row.core && row.state === 'PENDING' && filledBefore.has(row.key),
      )
      .map((row) => row.key);
    if (emptied.length) return { ok: false, code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED', keys: emptied };
  }
  if (after !== before)
    return passes({ code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE', keys: afterView.pendingCore });
  const pendingBefore = new Set(beforeView.pendingCore);
  return passes({
    code: 'ROUTE_PACK_CORE_TURNS_PENDING',
    keys: afterView.pendingCore.filter((key) => !pendingBefore.has(key)),
  });
}
// The person-facing words of a go-live warning or refusal, with field labels instead of keys.
export function goLiveMessage(result: GoLiveWarning | Extract<GoLiveResult, { ok: false }>) {
  const labels = result.keys.map((key) => standardFieldByKey.get(key)?.label ?? key).join(', ');
  if (result.code === 'ROUTE_PACK_LOCKED_CORE_EMPTIED')
    return routePackWords.lockedCoreEmptied(labels);
  return result.code === 'ROUTE_PACK_GO_LIVE_PENDING_CORE'
    ? routePackWords.goLivePendingCore(labels)
    : routePackWords.coreTurnsPending(labels);
}

// Carry-over (ADR-093 B): a pack built by the import or the guided form copies every key it does not set from the current
// pack unchanged; a route with no pack starts from empty lists, null references, review required and no sourcing block.
// The sourcing block is removed only by the explicit "Remove sourcing profile" choice.
export function carriedConfiguration(
  current: RouteConfiguration | null,
  set: Partial<Pick<RouteConfiguration, SheetLockedKey>>,
  options: { removeSourcing?: boolean } = {},
): RouteConfiguration {
  const base: RouteConfiguration = current ?? {
    missionTypes: [],
    requiredCapabilities: [],
    languages: [],
    currencies: [],
    timeZones: [],
    localities: [],
    clusters: [],
    requirements: [],
    assessments: [],
    sourceCategories: [],
    channels: [],
    jurisdictionPolicyRefs: [],
    evidenceTypes: [],
    reviewRequired: true,
    operatorCapabilities: [],
    coverage: [],
    aiPolicyRef: null,
    pricingRef: null,
  };
  const next: RouteConfiguration = { ...base };
  for (const key of sheetLockedKeys) {
    const value = set[key];
    if (value !== undefined) Object.assign(next, { [key]: [...value] });
  }
  if (options.removeSourcing) delete next.sourcing;
  return next;
}

// A custom key keeps one meaning in a workspace (ADR-093 E): the same section, type and allowed values on every route. The
// label is not compared. Callers pass the latest document of every route, with the documents about to be saved in place.
export function customKeyConflicts(
  documents: Iterable<readonly [routeId: string, ContentDocument]>,
): { key: string; routeIds: string[] }[] {
  const meanings = new Map<string, { signatures: Set<string>; routeIds: Set<string> }>();
  for (const [routeId, document] of documents)
    for (const fact of document.facts) {
      if (!fact.key.startsWith('custom.')) continue;
      const signature = JSON.stringify([
        fact.section,
        fact.type,
        [...new Set(fact.allowedValues ?? [])].sort(),
      ]);
      const entry = meanings.get(fact.key) ?? { signatures: new Set(), routeIds: new Set() };
      entry.signatures.add(signature);
      entry.routeIds.add(routeId);
      meanings.set(fact.key, entry);
    }
  return [...meanings]
    .filter(([, entry]) => entry.signatures.size > 1)
    .map(([key, entry]) => ({ key, routeIds: [...entry.routeIds].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// The label of each custom key as the latest save gave it (ADR-093 E): the label is shown for the key on every route. Saves
// are ordered by time, then by content version, then by route key, so two saves in one transaction still give one answer.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
// The reason of a PAUSED publish that dropped expired policy references, so the pack history shows what was removed. It
// stays within the 500 character reason limit: names that do not fit end as "and N more", and only when even the shortest
// note does not fit is the person's own reason shortened.
const reasonLimit = 500;
export function reasonWithRemovedPolicies(reason: string, names: readonly string[]): string {
  if (!names.length) return reason;
  const note = (shown: number) =>
    routePackWords.expiredPoliciesRemoved(
      shown === names.length
        ? names.join(', ')
        : shown
          ? `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`
          : `${names.length} policies`,
    );
  for (let shown = names.length; shown >= 0; shown--) {
    const full = reason + note(shown);
    if (full.length <= reasonLimit) return full;
  }
  return reason.slice(0, reasonLimit - note(0).length).trimEnd() + note(0);
}
// True when a recorded reason is this reason with the note of removed policies added.
export function recordsRemovedPolicies(recorded: string, reason: string): boolean {
  return recorded.startsWith(reason + expiredPoliciesNote);
}
export function latestCustomLabels(
  contents: Iterable<{
    routeKey: string;
    version: number;
    createdAt: string;
    document: ContentDocument;
  }>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  const ordered = [...contents].sort(
    (a, b) =>
      byText(a.createdAt, b.createdAt) || a.version - b.version || byText(a.routeKey, b.routeKey),
  );
  for (const content of ordered)
    for (const fact of content.document.facts)
      if (fact.key.startsWith('custom.') && fact.label) labels[fact.key] = fact.label;
  return labels;
}

// The long sheet (ADR-093 G): one row per route and field.
export const sheetColumns = [
  'route',
  'section',
  'field_key',
  'label',
  'part',
  'core',
  'type',
  'format',
  'state',
  'value',
  'source',
  'observed_on',
  'valid_until',
  'note',
  'help',
] as const;
// The blank template for one route: the header and every standard field, Pending, in registry order.
export function blankSheetRows(route: string): string[][] {
  return [
    [...sheetColumns],
    ...standardFieldsV1.map((field) => [
      route,
      routePackSections[field.section - 1]!.name,
      field.key,
      field.label,
      field.part,
      field.core ? 'Core' : 'Optional',
      field.type,
      field.format,
      'Pending',
      '',
      '',
      '',
      '',
      '',
      field.help,
    ]),
  ];
}
