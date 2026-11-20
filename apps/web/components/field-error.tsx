// One shared field error (Wave 3 unit 09): an alert icon, a 2 px edge in the critical token and the words. The caller
// gives it the id its field names in aria-describedby and sets aria-invalid on the field. It holds no control. The
// words say what to do, and the icon and the edge never carry the meaning alone.
import type { ReactNode } from 'react';
import { CorridraIcon } from './corridra-icon';
import './field-error.css';

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="field-error ux-field-error" role="alert">
      <CorridraIcon name="alert" />
      <span>{children}</span>
    </p>
  );
}
