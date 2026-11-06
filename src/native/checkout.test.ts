import { describe, expect, it } from "vitest";
import { checkoutNext, deadlineCalendar, workshopPolicy } from "./checkout";
const member = {
  connected: true,
  fresh: true,
  mapped: true,
  state: 1,
  now: 100n,
  funding: 200n,
  capture: 300n,
  share: 10n,
  contributed: 0n,
  credit: 0n,
  balance: 20n,
  allowance: 0n,
  merchant: false,
};
describe("checkout guidance", () => {
  it("does not confuse approval with payment", () => {
    expect(checkoutNext(member)).toContain("approval");
    expect(checkoutNext({ ...member, allowance: 10n })).toContain(
      "Approval alone has not paid",
    );
    expect(checkoutNext({ ...member, contributed: 10n })).toContain(
      "Your share is funded",
    );
  });
  it("prioritizes current authority and reads over saved credit", () => {
    expect(checkoutNext({ ...member, fresh: false, credit: 10n })).toContain(
      "Refresh",
    );
    expect(
      checkoutNext({ ...member, connected: false, credit: 10n }),
    ).toContain("Connect");
    expect(checkoutNext({ ...member, now: 200n })).toContain("Process expiry");
  });
  it("exports two local events and escapes injected calendar lines", () => {
    const result = deadlineCalendar(
      "0x123",
      "Workshop\nBEGIN:VEVENT,yes;",
      200n,
      300n,
      new Date(0),
    );
    expect(result.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(2);
    expect(result).toContain("Workshop\\nBEGIN:VEVENT\\,yes\\;");
    expect(result).not.toContain("VALARM");
    expect(workshopPolicy).toContain(
      "no automatic refund or delivery guarantee",
    );
  });
});
