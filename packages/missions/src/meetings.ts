import { createHash } from 'node:crypto';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  assertMeetingTransition,
  meetingCommand,
  type MeetingStatus,
} from '@corridra/domain/access';
export class MeetingService {
  constructor(private pool: DatabasePool) {}
  workspace(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'meetings.read', async ({ db, role }) => {
      const meetings = (
        await db.query(
          `SELECT m.*,b.body AS brief FROM app.meeting m JOIN app.meeting_brief b ON b.tenant_id=m.tenant_id AND b.meeting_id=m.id
        WHERE m.tenant_id=$1 ORDER BY coalesce(m.starts_at,m.due_at),m.id LIMIT 100`,
          [ctx.tenantId],
        )
      ).rows;
      const ids = meetings.map((m) => m.id);
      const participants = (
        await db.query(
          'SELECT * FROM app.meeting_participant WHERE tenant_id=$1 AND meeting_id=ANY($2::uuid[]) ORDER BY created_at,id',
          [ctx.tenantId, ids],
        )
      ).rows;
      const outcomes = (
        await db.query(
          'SELECT * FROM app.meeting_outcome WHERE tenant_id=$1 AND meeting_id=ANY($2::uuid[]) ORDER BY observed_at DESC',
          [ctx.tenantId, ids],
        )
      ).rows;
      const followups = (
        await db.query(
          'SELECT * FROM app.follow_up WHERE tenant_id=$1 ORDER BY due_at,id LIMIT 100',
          [ctx.tenantId],
        )
      ).rows;
      const history = (
        await db.query(
          'SELECT * FROM app.meeting_command WHERE tenant_id=$1 AND meeting_id=ANY($2::uuid[]) ORDER BY created_at DESC LIMIT 200',
          [ctx.tenantId, ids],
        )
      ).rows;
      return {
        role,
        meetings,
        participants,
        outcomes,
        followups,
        history,
        owners: (await db.query('SELECT * FROM app.mission_owners($1)', [ctx.tenantId])).rows,
      };
    });
  }
  command(ctx: RequestContext, input: unknown) {
    const v = meetingCommand.parse(input),
      hash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
    return withTenant(this.pool, ctx, 'meetings.manage', async ({ db, actorId }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${ctx.tenantId}:meetings`,
      ]);
      const old = (
        await db.query('SELECT * FROM app.meeting_command WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          v.commandId,
        ])
      ).rows[0];
      if (old) {
        if (old.input_hash !== hash || old.created_by !== actorId)
          throw new DomainError('Command key reused with different values', 409);
        return old.result as { id: string; version: number };
      }
      let id: string,
        version: number,
        previous: unknown = null;
      if (v.action === 'propose' || v.action === 'proposeActivity') {
        const c =
          v.action === 'propose'
            ? (
                await db.query(
                  `SELECT c.id,t.mission_id FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id WHERE c.tenant_id=$1 AND c.id=$2`,
                  [ctx.tenantId, v.messageId],
                )
              ).rows[0]
            : (
                await db.query(
                  'SELECT id,mission_id FROM app.target_account WHERE tenant_id=$1 AND id=$2',
                  [ctx.tenantId, v.targetId],
                )
              ).rows[0];
        if (!c) throw new DomainError('Introduction unavailable', 404);
        id = v.commandId;
        version = 1;
        await db.query(
          `INSERT INTO app.meeting(id,tenant_id,message_id,mission_id,title,owner_id,next_action,due_at,reason,created_by${v.action === 'proposeActivity' ? ',target_id,activity_kind,activity_context' : ''}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10${v.action === 'proposeActivity' ? ',$11,$12,$13' : ''})`,
          [
            id,
            ctx.tenantId,
            v.action === 'propose' ? c.id : null,
            c.mission_id,
            v.title,
            v.ownerId,
            v.nextAction,
            v.dueAt,
            v.reason,
            actorId,
            ...(v.action === 'proposeActivity' ? [v.targetId, v.activityKind, v.context] : []),
          ],
        );
        await db.query(
          'INSERT INTO app.meeting_brief(tenant_id,meeting_id,body,created_by) VALUES($1,$2,$3,$4)',
          [ctx.tenantId, id, v.brief, actorId],
        );
        for (const name of v.participants)
          await db.query(
            'INSERT INTO app.meeting_participant(tenant_id,meeting_id,name,created_by) VALUES($1,$2,$3,$4)',
            [ctx.tenantId, id, name, actorId],
          );
      } else if (v.action === 'transition') {
        const m = (
          await db.query('SELECT * FROM app.meeting WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
            ctx.tenantId,
            v.id,
          ])
        ).rows[0];
        if (!m) throw new DomainError('Meeting unavailable', 404);
        if (m.version !== v.version)
          throw new DomainError('Meeting changed. Refresh before continuing.', 409);
        assertMeetingTransition(m.status as MeetingStatus, v.status);
        if (v.status === 'ACCEPTED' && !v.acceptance)
          throw new DomainError('Record the acceptance source', 400);
        if (v.status === 'SCHEDULED' && !v.schedule)
          throw new DomainError('Record the meeting schedule', 400);
        if (v.status !== 'SCHEDULED' && v.schedule)
          throw new DomainError('Schedule only after acceptance or a reschedule request', 400);
        if (v.status !== 'ACCEPTED' && (v.acceptance || v.responseId))
          throw new DomainError('Acceptance source belongs to the acceptance command', 400);
        if (['HELD', 'NO_SHOW'].includes(v.status) && !v.outcome)
          throw new DomainError('Record what happened', 400);
        if (!['HELD', 'NO_SHOW'].includes(v.status) && v.outcome)
          throw new DomainError('Outcomes belong to held or no-show meetings', 400);
        previous = {
          status: m.status,
          startsAt: m.starts_at,
          endsAt: m.ends_at,
          timezone: m.timezone,
          localStart: m.local_start,
          localEnd: m.local_end,
          location: m.location,
          version: m.version,
        };
        id = m.id;
        version = m.version + 1;
        const s = v.schedule;
        await db.query(
          `UPDATE app.meeting SET status=$3,version=version+1,reason=$4,owner_id=$5,next_action=$6,due_at=$7,
          acceptance=$8,response_id=$9,starts_at=$10,ends_at=$11,timezone=$12,local_start=$13,local_end=$14,location=$15 WHERE tenant_id=$1 AND id=$2`,
          [
            ctx.tenantId,
            id,
            v.status,
            v.reason,
            v.ownerId,
            v.nextAction,
            v.dueAt,
            v.status === 'ACCEPTED' ? v.acceptance : m.acceptance,
            v.status === 'ACCEPTED' ? (v.responseId ?? null) : m.response_id,
            s?.startsAt ?? m.starts_at,
            s?.endsAt ?? m.ends_at,
            s?.timezone ?? m.timezone,
            s?.localStart ?? m.local_start,
            s?.localEnd ?? m.local_end,
            s?.location ?? m.location,
          ],
        );
        if (v.outcome) {
          await db.query(
            'INSERT INTO app.meeting_outcome(id,tenant_id,meeting_id,status,summary,created_by) VALUES($1,$2,$3,$4,$5,$6)',
            [v.commandId, ctx.tenantId, id, v.status, v.outcome, actorId],
          );
          if (v.status === 'HELD')
            await db.query(
              'INSERT INTO app.follow_up(id,tenant_id,meeting_id,outcome_id,owner_id,next_action,due_at,reason,created_by) VALUES($1,$2,$1,$3,$4,$5,$6,$7,$8)',
              [id, ctx.tenantId, v.commandId, v.ownerId, v.nextAction, v.dueAt, v.reason, actorId],
            );
        }
      } else {
        const f = (
          await db.query('SELECT * FROM app.follow_up WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
            ctx.tenantId,
            v.id,
          ])
        ).rows[0];
        if (!f) throw new DomainError('Follow-up unavailable', 404);
        if (f.version !== v.version || f.status !== 'OPEN')
          throw new DomainError('Follow-up changed. Refresh before continuing.', 409);
        await db.query(
          'UPDATE app.follow_up SET status=$3,version=version+1,reason=$4 WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, v.id, v.status, v.reason],
        );
        id = f.meeting_id;
        version = f.version + 1;
      }
      const result = { id, version };
      await db.query(
        'INSERT INTO app.meeting_command(id,tenant_id,meeting_id,action,input_hash,details,result,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)',
        [
          v.commandId,
          ctx.tenantId,
          id,
          v.action,
          hash,
          JSON.stringify({ command: v, previous }),
          JSON.stringify(result),
          actorId,
        ],
      );
      return result;
    });
  }
}
