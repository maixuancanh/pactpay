export const workshopPolicy =
  "Booking policy: this is a fixed-share workshop booking. Members may withdraw while collection is open, until all shares are funded. The merchant may cancel before capture. After capture there is no automatic refund or delivery guarantee; any service dispute must be resolved with the merchant outside PactPay. If funding or capture expires, someone must process expiry before each member claims their refund.";

export function checkoutNext(input: {
  connected: boolean;
  fresh: boolean;
  mapped: boolean;
  state: number;
  now: bigint;
  funding: bigint;
  capture: bigint;
  share: bigint;
  contributed: bigint;
  credit: bigint;
  balance: bigint;
  allowance: bigint;
  merchant: boolean;
}) {
  if (!input.connected)
    return "Connect the native wallet named in this agreement.";
  if (!input.mapped)
    return "Verify your wallet’s runtime mapping before payment.";
  if (!input.fresh)
    return "Refresh this agreement to check balances and available actions.";
  if (input.credit > 0n)
    return "Claim your available credit to transfer dUSD to your wallet.";
  if (
    (input.state === 1 && input.now >= input.funding) ||
    (input.state === 2 && input.now >= input.capture)
  )
    return "Process expiry, then each contributor can claim their refund.";
  if (input.state === 2)
    return input.merchant
      ? "Capture the funded collection before the deadline, then claim your credit."
      : "Your group is funded. Wait for the merchant to capture before the deadline.";
  if (input.state !== 1)
    return "Collection is closed. Check for claimable credit or review the receipt.";
  if (input.share === 0n)
    return input.merchant
      ? "Share the agreement with members and wait for their fixed shares."
      : "This wallet is not a paying member. Connect the member wallet to contribute.";
  if (input.contributed > 0n)
    return "Your share is funded. Wait for the remaining members; withdrawal is available until the group is ready.";
  if (input.balance < input.share)
    return "Add demo dUSD to this wallet before paying your fixed share.";
  if (input.allowance < input.share)
    return "Review approval for your exact share, then return to contribute.";
  return "Review your contribution. Approval alone has not paid your share.";
}

const escapeCalendar = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
export function deadlineCalendar(
  id: string,
  title: string,
  funding: bigint,
  capture: bigint,
  createdAt = new Date(),
) {
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const events = [
    ["Funding closes", funding],
    ["Capture closes", capture],
  ] as const;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PactPay//Local deadlines//EN",
    ...events.flatMap(([label, time]) => [
      "BEGIN:VEVENT",
      `UID:${id}-${label.split(" ")[0]}@pactpay.local`,
      `DTSTAMP:${stamp(createdAt)}`,
      `DTSTART:${stamp(new Date(Number(time) * 1000))}`,
      `DTEND:${stamp(new Date((Number(time) + 60) * 1000))}`,
      `SUMMARY:${escapeCalendar(`${label}: ${title}`)}`,
      "DESCRIPTION:Open PactPay and refresh chain state. This calendar entry does not execute a transaction or send an external notification.",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
