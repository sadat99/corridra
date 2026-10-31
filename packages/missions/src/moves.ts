import { createHash } from 'node:crypto';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { DomainError, stepUpRequired } from '@corridra/domain';
import { moveCommand } from '@corridra/domain/moves';

// Move records written by the Corridra team (ADR-068). The database is the authority: it checks the
// control, the actor, the words, the date window and the cap of five open Moves per request. This
// service gives the command its shape, its permission and its idempotence. A Move is a message to a
// customer, so it needs a fresh authenticator check, as the sensitive staff commands do.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type MoveHistoryRow = {
  id: string;
  verb: string;
  object: string;
  holder: string;
  dueOn: string | null;
  position: number;
  setAt: string;
  setBy: string;
  closed: null | { outcome: 'DONE' | 'CLEARED'; at: string; by: string };
};

export class MissionMoveService {
  constructor(private pool: DatabasePool) {}

  /** The whole history of a mission's Moves, open and closed, oldest first. */
  history(ctx: RequestContext, missionId: string) {
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, tenantId }) => {
      const { rows } = await db.query(
        `SELECT m.id,m.verb,m.object,m.holder,to_char(m.due_on,'YYYY-MM-DD') AS due_on,m.position,m.created_at,m.created_by,
          c.outcome,c.created_at AS closed_at,c.closed_by
         FROM app.mission_move m LEFT JOIN app.mission_move_close c ON c.move_id=m.id
         WHERE m.tenant_id=$1 AND m.mission_id=$2 ORDER BY m.created_at,m.position`,
        [tenantId, missionId],
      );
      return rows.map((row): MoveHistoryRow => ({
        id: row.id,
        verb: row.verb,
        object: row.object,
        holder: row.holder,
        dueOn: row.due_on,
        position: row.position,
        setAt: new Date(row.created_at).toISOString(),
        setBy: row.created_by,
        closed: row.outcome
          ? {
              outcome: row.outcome,
              at: new Date(row.closed_at).toISOString(),
              by: row.closed_by,
            }
          : null,
      }));
    });
  }

  /** set replaces the open Moves with a new list; done closes one; clear closes all of them. */
  async command(ctx: RequestContext, input: unknown) {
    const value = moveCommand.parse(input);
    const inputHash = hash(value);
    return withTenant(
      this.pool,
      ctx,
      'missions.manage',
      async ({ db, actorId, tenantId, freshMfa }) => {
        if (!freshMfa) throw stepUpRequired();
        // One command at a time per mission: the cap and the replacement are decided under this lock.
        await db.query('SELECT id FROM app.mission WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
          tenantId,
          value.missionId,
        ]);
        const {
          rows: [old],
        } = await db.query('SELECT * FROM app.mission_move_command WHERE id=$1', [value.commandId]);
        if (old) {
          if (
            old.tenant_id !== tenantId ||
            old.mission_id !== value.missionId ||
            old.actor_id !== actorId ||
            old.input_hash !== inputHash
          )
            throw new DomainError('Move command key reused', 409);
          return { replayed: true, commandId: value.commandId };
        }
        const exists = await db.query('SELECT 1 FROM app.mission WHERE tenant_id=$1 AND id=$2', [
          tenantId,
          value.missionId,
        ]);
        if (!exists.rowCount) throw new DomainError('Mission not found', 404);
        await db.query(
          `INSERT INTO app.mission_move_command(id,tenant_id,mission_id,kind,input_hash,actor_id)
         VALUES($1,$2,$3,$4,$5,$6)`,
          [
            value.commandId,
            tenantId,
            value.missionId,
            value.action === 'set' ? 'SET' : value.action === 'done' ? 'DONE' : 'CLEAR',
            inputHash,
            actorId,
          ],
        );
        const open = (
          await db.query<{ id: string }>(
            `SELECT m.id FROM app.mission_move m WHERE m.tenant_id=$1 AND m.mission_id=$2
           AND NOT EXISTS(SELECT 1 FROM app.mission_move_close c WHERE c.move_id=m.id) ORDER BY m.position`,
            [tenantId, value.missionId],
          )
        ).rows;
        const close = async (ids: string[], outcome: 'DONE' | 'CLEARED') => {
          for (const id of ids)
            await db.query(
              `INSERT INTO app.mission_move_close(tenant_id,mission_id,move_id,outcome,command_id,closed_by)
             VALUES($1,$2,$3,$4,$5,$6)`,
              [tenantId, value.missionId, id, outcome, value.commandId, actorId],
            );
        };
        if (value.action === 'done') {
          if (!open.some((row) => row.id === value.moveId))
            throw new DomainError('That Move is not open', 409);
          await close([value.moveId], 'DONE');
          return { replayed: false, commandId: value.commandId };
        }
        await close(
          open.map((row) => row.id),
          'CLEARED',
        );
        if (value.action === 'set')
          for (const [index, move] of value.moves.entries())
            await db.query(
              `INSERT INTO app.mission_move(tenant_id,mission_id,command_id,position,verb,object,holder,due_on,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                tenantId,
                value.missionId,
                value.commandId,
                index + 1,
                move.verb,
                move.object,
                move.holder,
                move.dueOn,
                actorId,
              ],
            );
        return { replayed: false, commandId: value.commandId };
      },
    );
  }
}
