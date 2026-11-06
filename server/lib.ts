import { createHash, randomBytes, randomUUID } from "node:crypto";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  value: unknown,
  code: string,
  message = code,
  status = 400,
): asserts value {
  if (!value) throw new ApiError(status, code, message);
}
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function text(value: unknown, max = 2000): string {
  requireThat(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    "invalid_text",
  );
  return value.trim();
}
export function amount(value: unknown): string {
  requireThat(
    typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value),
    "invalid_amount",
  );
  return value;
}
export function positive(value: unknown): string {
  const a = amount(value);
  requireThat(BigInt(a) > 0n, "positive_amount_required");
  return a;
}
export function address(value: unknown): string {
  requireThat(
    typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
    "invalid_address",
  );
  return value.toLowerCase();
}
export function hex32(value: unknown): string {
  requireThat(
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
    "invalid_hash",
  );
  return value.toLowerCase();
}
export function integer(value: unknown, min: number, max: number): number {
  requireThat(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
    "invalid_integer",
  );
  return value;
}
export function future(value: unknown, now = new Date()): string {
  requireThat(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      Date.parse(value) > now.getTime(),
    "invalid_future_time",
  );
  return new Date(value).toISOString();
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
