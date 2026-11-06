import {useEffect, useState} from 'react';
import {api} from './api';
import type {Room} from './types';

type Confirmation = {userId: string; confirmedAt: string};

export function RoomAttendance({room, userId}: {room: Room; userId: string}) {
  const [confirmations, setConfirmations] = useState<Confirmation[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const member = room.members.some(person => person.userId === userId);
  const self = confirmations?.some(item => item.userId === userId);
  const path = `/rooms/${room.id}/attendance`;

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<{confirmations: Confirmation[]}>(path, 'GET', undefined, controller.signal)
      .then(data => {if (!controller.signal.aborted) setConfirmations(data.confirmations);})
      .catch(() => {if (!controller.signal.aborted) setError('Attendance could not be loaded.');});
    return () => controller.abort();
  }, [path, reload]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const data = await api<{confirmations: Confirmation[]}>(path, 'POST', {});
      setConfirmations(data.confirmations);
    } catch {
      setError('Attendance could not be saved. Try again after the scheduled start.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="pp-panel" aria-label="Attendance">
    <h2>Attendance</h2>
    <p>Members can confirm they attended once the booking starts. Confirmations are visible in this room and leave payments and refunds unchanged.</p>
    {confirmations && <p>{confirmations.length} of {room.members.length} members confirmed.</p>}
    {confirmations && confirmations.length > 0 && <ul>{confirmations.map(item => <li key={item.userId}>
      {room.members.find(person => person.userId === item.userId)?.nickname ?? 'Member'} · {new Date(item.confirmedAt).toLocaleString('en-GB')}
    </li>)}</ul>}
    {member && self && <p role="status">You confirmed your attendance.</p>}
    {member && !self && now < Date.parse(room.serviceAt) && <p>Confirmation opens at the scheduled start.</p>}
    {member && confirmations && !self && now >= Date.parse(room.serviceAt) && <button className="pp-secondary" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Saving…' : 'I attended'}</button>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="pp-text" onClick={() => setReload(n => n + 1)}>Refresh attendance</button></div>}
  </section>;
}
