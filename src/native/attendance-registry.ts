import type { SignedAttendance } from "./attendance";
import {decodeAddress} from '@polkadot/util-crypto';
import {u8aToHex} from '@polkadot/util';
/** Inputs must have passed signature and mapped-member verification before committing. */
export function mergeAttendance(
  current: SignedAttendance[],
  incoming: SignedAttendance[],
) {
  if (incoming.length > 50 || current.length > 50)
    throw Error("Import at most 50 statements");
  const map = new Map<string, SignedAttendance>();
  for (const item of [...current, ...incoming]) {
    const s = item.statement,
      key = [s.genesis, s.contract, s.quoteId, u8aToHex(decodeAddress(s.attendee)), s.nonce]
        .join(":")
        .toLowerCase();
    const previous = map.get(key);
    const canonical=(value:SignedAttendance)=>JSON.stringify({statement:Object.fromEntries(Object.entries(value.statement).sort(([a],[b])=>a.localeCompare(b))),signature:value.signature});
    if (previous && canonical(previous) !== canonical(item))
      throw Error("Conflicting statement reuses an attendee nonce");
    map.set(key, item);
  }
  if (map.size > 50) throw Error("Keep at most 50 statements per booking");
  return [...map.values()];
}
