import { it, expect } from "vitest";
import { agreementNotice, isSnapshotFresh } from "./live-state";
it("offers exact deadline actions from chain time without promising automatic refunds", () => {
  expect(agreementNotice(1, 100n, 100n, 200n, false, 0n)).toMatch(/expiry/);
  expect(agreementNotice(2, 199n, 100n, 200n, true, 0n)).toMatch(/Capture/);
  expect(agreementNotice(2, 200n, 100n, 200n, true, 0n)).toMatch(/expiry/);
  expect(agreementNotice(4, 200n, 100n, 200n, false, 10n)).toMatch(/Claim/);
});
it("fails closed after old, future or failed snapshot reads", () => {
  expect(isSnapshotFresh(1000, 1099, false)).toBe(true);
  expect(isSnapshotFresh(1000, 50000, false)).toBe(false);
  expect(isSnapshotFresh(2000, 1000, false)).toBe(false);
  expect(isSnapshotFresh(1000, 1001, true)).toBe(false);
});
it("does not claim payout or refund completion from zero credit", () => {
  expect(agreementNotice(3, 10n, 20n, 30n, true, 0n)).toMatch(/evidence/);
  expect(agreementNotice(4, 10n, 20n, 30n, false, 0n)).toMatch(/does not prove/);
});
