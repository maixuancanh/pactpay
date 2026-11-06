import { it, expect } from "vitest";
import { parseDraft, emptyDraft } from "./draft";
it("retains bounded unfinished form data but excludes operational fields", () => {
  const d = parseDraft({
    ...emptyDraft(),
    title: "A workshop",
    members: [{ address: "5unfinished", amount: "1." }],
    signed: "0xsecret",
    pending: {},
  });
  expect(d.title).toBe("A workshop");
  expect(d.members[0].amount).toBe("1.");
  expect(JSON.stringify(d)).not.toMatch(/secret|pending/);
});
it("rejects oversized or malformed draft content", () => {
  expect(() =>
    parseDraft({ ...emptyDraft(), title: "x".repeat(121) }),
  ).toThrow();
  expect(() =>
    parseDraft({
      ...emptyDraft(),
      members: Array(6).fill({ address: "5", amount: "1" }),
    }),
  ).toThrow();
  expect(() => parseDraft({ ...emptyDraft(), hours: "900" })).toThrow();
});
