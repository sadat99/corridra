// ADR-083 slice S1. Reference contents for the Bangladesh to China sourcing route profile. A reviewed test fixture, not a seed:
// nothing here is written to any tenant. When the owner opens the module, a person proposes it through the reviewed pack flow
// as a new pack version of the BD to CN route and an independent reviewer approves it. Opening it is configuration, not launch
// approval, and the route stays at TESTING. Context prompts are plain English. Chinese wording is never written here: it needs
// native review, which stays a closed gate.
import type { SourcingProfile } from '../../../packages/domain/src/corridors';

export const bdCnSourcingProfile: SourcingProfile = {
  profileVersion: 1,
  categories: [
    {
      key: 'fabric_and_trims',
      context:
        'Tell us the fabric or trim, the width or size, the weight, the colour standard and any test you need.',
      requiredFields: ['product', 'quantity', 'unit', 'specification', 'delivery'],
      comparisonTerms: [
        'specification',
        'quantity',
        'moq',
        'unit',
        'unitPriceMinor',
        'totalPriceMinor',
        'leadTime',
        'incoterm',
        'paymentTerms',
        'validUntil',
      ],
      documentKinds: ['test_report', 'fibre_declaration'],
    },
    {
      key: 'machinery',
      context:
        'Tell us the machine type, the output you need, the power supply and where it will stand.',
      requiredFields: ['product', 'quantity', 'specification', 'delivery', 'machinery'],
      comparisonTerms: [
        'specification',
        'quantity',
        'unitPriceMinor',
        'totalPriceMinor',
        'leadTime',
        'incoterm',
        'shipping',
        'paymentTerms',
        'installation',
        'commissioning',
        'warranty',
        'training',
        'spares',
        'validUntil',
      ],
      documentKinds: ['conformity', 'manual', 'warranty_card'],
    },
    {
      key: 'packaging',
      context: 'Tell us the pack type, the print needs, the size and the quantity per carton.',
      requiredFields: ['product', 'quantity', 'unit', 'specification'],
      comparisonTerms: [
        'specification',
        'quantity',
        'moq',
        'unit',
        'unitPriceMinor',
        'toolingMinor',
        'packagingMinor',
        'leadTime',
        'incoterm',
        'paymentTerms',
      ],
      documentKinds: ['print_proof'],
    },
  ],
  landedCostElements: [
    'goods',
    'tooling',
    'packaging',
    'inland_freight',
    'export_clearance',
    'freight',
    'insurance',
    'duty_and_tax',
    'port_and_clearance',
    'inland_delivery',
    'installation',
    'certification',
    'bank_and_fx',
    'agent_fee',
    'spares',
  ],
  incotermHints: ['FOB', 'CIF'],
  sampleSteps: [
    { key: 'request_sample', label: 'Ask for a sample' },
    { key: 'check_sample', label: 'Check the sample' },
  ],
  visitKinds: ['factory_visit', 'trade_fair', 'showroom_visit'],
  supplierReplyLanguages: ['zh-CN', 'en'],
  ports: ['Shanghai', 'Ningbo', 'Guangzhou', 'Chattogram'],
  readiness: {
    understood: ['product'],
    research: ['product', 'quantity', 'unit'],
    comparableQuotes: ['product', 'quantity', 'unit', 'specification', 'delivery', 'incoterm'],
    readyToCommit: [
      'product',
      'quantity',
      'unit',
      'specification',
      'delivery',
      'incoterm',
      'payment',
    ],
  },
};
