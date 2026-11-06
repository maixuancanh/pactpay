import {
  address,
  hex32,
  integer,
  positive,
  requireThat,
  text,
} from "../lib.js";
export type SponsorAuthorization = {
  chainId: number;
  account: string;
  roomId: string;
  contract: string;
  function: string;
  amount: string;
  recipient: string;
  expiresAt: string;
  nonce: string;
};
export type SponsorPolicy = {
  chainId: number;
  contracts: Record<string, string[]>;
  maxPerAction: string;
  maxPerAccountDay: string;
  maxPerRoomDay: string;
  maxPerRoom?: string;
  enabled: boolean;
};
export function validateSponsorship(
  raw: SponsorAuthorization,
  p: SponsorPolicy,
  now = new Date(),
) {
  requireThat(p.enabled, "sponsor_disabled", undefined, 503);
  const a = {
    chainId: integer(raw.chainId, 1, Number.MAX_SAFE_INTEGER),
    account: address(raw.account),
    roomId: text(raw.roomId, 100),
    contract: address(raw.contract),
    function: text(raw.function, 100),
    amount: positive(raw.amount),
    recipient: address(raw.recipient),
    expiresAt: text(raw.expiresAt, 100),
    nonce: text(raw.nonce, 100),
  };
  requireThat(
    a.chainId === p.chainId && p.contracts[a.contract]?.includes(a.function),
    "sponsor_target_not_allowed",
    undefined,
    403,
  );
  requireThat(BigInt(a.amount) <= BigInt(p.maxPerAction), "sponsor_action_cap");
  requireThat(
    Date.parse(a.expiresAt) > now.getTime() &&
      Date.parse(a.expiresAt) <= now.getTime() + 300000,
    "sponsor_expiry",
  );
  return a;
}
