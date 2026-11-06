export type CreateDraft = {
  title: string;
  description: string;
  merchantName: string;
  members: { address: string; amount: string }[];
  hours: string;
  captureHours: string;
};
export const DRAFT_KEY = "pactpay.native.create-draft:v1";
export const emptyDraft = (): CreateDraft => ({
  title: "",
  description: "",
  merchantName: "",
  members: [{ address: "", amount: "10" }],
  hours: "24",
  captureHours: "24",
});
export function parseDraft(value: unknown): CreateDraft {
  const x = value as CreateDraft;
  if (
    !x ||
    typeof x !== "object" ||
    typeof x.title !== "string" ||
    x.title.length > 120 ||
    typeof x.description !== "string" ||
    x.description.length > 4000 ||
    typeof x.merchantName !== "string" ||
    x.merchantName.length > 100 ||
    !Array.isArray(x.members) ||
    x.members.length < 1 ||
    x.members.length > 5
  )
    throw Error("Saved draft is invalid.");
  const members = x.members.map((m) => {
    if (
      typeof m?.address !== "string" ||
      m.address.length > 64 ||
      typeof m.amount !== "string" ||
      m.amount.length > 32 ||
      !/^\d*(?:\.\d{0,6})?$/.test(m.amount)
    )
      throw Error("Saved member draft is invalid.");
    return { address: m.address, amount: m.amount };
  });
  for (const h of [x.hours, x.captureHours])
    if (
      typeof h !== "string" ||
      h.length > 3 ||
      !/^\d*$/.test(h) ||
      (h !== "" && Number(h) > 720)
    )
      throw Error("Saved draft duration is invalid.");
  return {
    title: x.title,
    description: x.description,
    merchantName: x.merchantName,
    members,
    hours: x.hours,
    captureHours: x.captureHours,
  };
}
export function loadDraft(storage: Pick<Storage, "getItem">): CreateDraft {
  try {
    const raw = storage.getItem(DRAFT_KEY);
    return raw && raw.length < 8000
      ? parseDraft(JSON.parse(raw))
      : emptyDraft();
  } catch {
    return emptyDraft();
  }
}
