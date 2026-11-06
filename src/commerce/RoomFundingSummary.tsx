import {formatAmount} from './model';
import type {Room} from './types';

export function RoomFundingSummary({room, stale}: {room: Room; stale: boolean}) {
  const agreed = room.members.filter(member => member.acceptedRevision === room.revision).length;
  const recorded = room.members.filter(member => member.paymentFinalized === true).length;
  const fundingDeadline = new Date(room.fundingDeadline).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <>
      <div className="pp-between"><span>Funding deadline</span><strong>{fundingDeadline} ({timeZone})</strong></div>
      <div className="pp-between"><span>Agreed to these terms</span><strong>{agreed} / {room.members.length}</strong></div>
      {room.quote && (
        <div className="pp-between">
          <span>Members with recorded payments</span>
          <strong>{stale ? 'Refresh needed' : `${recorded} / ${room.members.length}`}</strong>
        </div>
      )}
      {!room.quote && <p className="pp-muted">Payments open after the organizer publishes the agreed booking.</p>}
      <div className="pp-between"><span>Group total</span><strong>{formatAmount(room.total)} dUSD</strong></div>
    </>
  );
}
