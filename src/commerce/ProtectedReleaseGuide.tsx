type Booking = {
  state: number;
  funded: string;
  total: string;
  fundingDeadline: string;
  captureDeadline: string;
  capturedAt: string;
  window: string;
  resolutionPeriod: string;
};

export function ProtectedReleaseGuide({booking, now, disputed, settled}: {
  booking: Booking; now: bigint; disputed: boolean; settled: boolean;
}) {
  const capture = BigInt(booking.captureDeadline);
  const funding = BigInt(booking.fundingDeadline);
  const complaint = BigInt(booking.capturedAt) + BigInt(booking.window);
  const resolution = complaint + BigInt(booking.resolutionPeriod);
  const full = BigInt(booking.funded) === BigInt(booking.total);
  const showTime = (seconds: bigint) => new Date(Number(seconds) * 1000).toLocaleString('en-GB', {timeZoneName: 'short'});
  let who: string;
  let detail: string;
  if (settled) {
    who = 'Eligible recipient';
    detail = 'Receive any available wallet credit. Check the finalized transfer to confirm receipt.';
  } else if (Number(booking.state) === 3 || (Number(booking.state) === 1 && (now >= capture || (!full && now >= funding)))) {
    who = 'Anyone can settle each paid share';
    detail = 'Settlement makes the refund available. Each recipient then receives their own credit.';
  } else if (Number(booking.state) === 1 && full) {
    who = 'Organizer can capture';
    detail = 'Capture by ' + showTime(capture) + '. The complaint window starts at capture.';
  } else if (Number(booking.state) === 1) {
    who = 'Members with an unpaid share';
    detail = 'Contribute by ' + showTime(funding) + '. The organizer can capture only after all shares are paid.';
  } else if (disputed && now < resolution) {
    who = 'Buyer and organizer';
    detail = 'Both can sign an agreed split before ' + showTime(resolution) + '. After that, anyone can settle this share to a full buyer refund.';
  } else if (now < complaint) {
    who = 'Paid member';
    detail = 'A complaint can be opened by ' + showTime(complaint) + '. This share stays held until settlement.';
  } else {
    who = 'Anyone can settle this share';
    detail = disputed ? 'The resolution deadline passed. This share can be allocated to a buyer refund.' :
      'The complaint window closed. This share can be allocated to merchant credit.';
  }
  return <div className="pp-message"><strong>Next step · {who}</strong><p>{detail}</p></div>;
}
