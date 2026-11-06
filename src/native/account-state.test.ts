import { expect, it } from "vitest";
import {
  accountPermissionChange,
  assertReviewAuthority,
  selectedAuthorityChanged,
} from "./account-state";
it("keeps shared selection but never switches authority when active account is removed", () => {
  expect(
    accountPermissionChange("alice", [
      { address: "alice" },
      { address: "bob" },
    ]),
  ).toEqual({ selected: "alice", removed: false });
  expect(accountPermissionChange("alice", [{ address: "bob" }])).toEqual({
    selected: "",
    removed: true,
  });
  expect(accountPermissionChange("", [{ address: "bob" }])).toEqual({
    selected: "",
    removed: false,
  });
});
it('ignores account list replays and metadata changes, invalidates removal or signer replacement',()=>{
 const before=[{address:'alice',source:'polkadot-js'}];
 expect(selectedAuthorityChanged('alice',before,[{address:'alice',source:'polkadot-js'}])).toBe(false);
 expect(selectedAuthorityChanged('alice',before,[{address:'bob',source:'polkadot-js'},...before])).toBe(false);
 expect(selectedAuthorityChanged('alice',before,[])).toBe(true);
 expect(selectedAuthorityChanged('alice',before,[{address:'alice',source:'other'}])).toBe(true);
});
it("rejects work prepared before an authority change even if the same account reconnects", () => {
  expect(() => assertReviewAuthority(1, 2, "alice", "alice")).toThrow(
    /changed/,
  );
  expect(() => assertReviewAuthority(1, 1, "alice", "")).toThrow(/changed/);
  expect(() => assertReviewAuthority(1, 1, "alice", "alice")).not.toThrow();
});
