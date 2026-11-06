import type {Database, Sql} from '../db/database.js';
import {requireThat} from '../lib.js';
import {authorizedRoom} from './service.js';

export function roomAttendance(db: Database, clock = () => new Date()) {
  async function records(tx: Sql, roomId: string) {
    const result = await tx.query(
      'SELECT user_id, confirmed_at FROM room_attendance WHERE room_id=$1 ORDER BY user_id',
      [roomId],
    );
    return result.rows.map(row => ({
      userId: String(row.user_id),
      confirmedAt: new Date(row.confirmed_at).toISOString(),
    }));
  }

  return {
    async read(userId: string, roomId: string) {
      await authorizedRoom(db, roomId, userId);
      return records(db, roomId);
    },
    async confirm(userId: string, roomId: string) {
      return db.transaction(async tx => {
        const room = await authorizedRoom(tx, roomId, userId, false, true);
        const member = await tx.query('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, userId]);
        requireThat(member.rows.length, 'attendance_member_required', undefined, 403);
        const now = clock();
        requireThat(room.status === 'published' && now.getTime() >= new Date(room.service_at).getTime(), 'attendance_not_open', undefined, 409);
        await tx.query(
          'INSERT INTO room_attendance(room_id,user_id,confirmed_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [roomId, userId, now.toISOString()],
        );
        return records(tx, roomId);
      });
    },
  };
}
