import '../rooms/[requestId]/room-view.css';
import '../rooms/[requestId]/room-frame.css';
import '../../../components/mr/road.css';
import '../../../components/mr/stage-bar.css';
import '../../../components/mr/scripts.css';
import './programme-room.css';
import './programme-room-budget.css';
import '../page-budget.css';

// Only the page mounts this, and only with CORRIDRA_UX_PROGRAMME on. It draws nothing; it carries the
// stylesheets the Programme Room uses, so the delegation components themselves import no stylesheet.
export function ProgrammeRoomStyles() {
  return null;
}
