import { CorridraIcon } from '../../components/corridra-icon';
import './link-status.css';

// The one status line of a private page (UI/UX.v4.1 L8). When the link does not open it carries a lock beside the
// words it was given; it adds no words of its own and knows nothing about what the link would have shown. It stays
// the same live region in every state, so a change of words is announced once.
export function LinkStatus({ message, unavailable }: { message: string; unavailable: boolean }) {
  return (
    <p role="status" aria-live="polite" className={unavailable ? 'link-unavailable' : undefined}>
      {unavailable ? <CorridraIcon name="lock" /> : null}
      {message}
    </p>
  );
}
