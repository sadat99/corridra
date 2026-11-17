import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateViewerModule } from './viewer-module-run';

// ADR-087 quotation link check. Explicit optional installation, reached only through field_modules_action=quotation_link_check:
// adds app.quotation_linked_claim(tenant, claim), a SECURITY DEFINER boolean that quotationLinkedClaimSql calls once it exists,
// so a staff viewer reads no statement or file of a claim any quotation in the tenant names, whatever target it sits on. It
// refuses unless the customer real-use modules are installed, like the other ADR-087 viewer modules. The rollback folder is
// never applied. No runtime request receives this owner connection.
export function migrateQuotationLinkCheck(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateQuotationLinkCheck', () => migrateQuotationLinkCheckRun(pool));
}

async function migrateQuotationLinkCheckRun(pool: DatabasePool) {
  return migrateViewerModule(pool, {
    directory: new URL('../quotation-link-check-migrations/', import.meta.url),
    schema: 'quotation_link_check_migrations',
    label: 'Quotation link check',
  });
}
