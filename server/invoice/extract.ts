import sharp from "sharp";
import { amount, integer, requireThat, text } from "../lib.js";
export type Invoice = {
  currency: string;
  lineItems: { label: string; amount: string }[];
  subtotal: string;
  tax: string;
  service: string;
  discount: string;
  total: string;
  confidence: number;
};
export function validateInvoice(raw: Record<string, any>) {
  const currency = text(raw.currency, 12);
  requireThat(
    Array.isArray(raw.lineItems) &&
      raw.lineItems.length >= 1 &&
      raw.lineItems.length <= 200,
    "invalid_line_items",
  );
  const lineItems = raw.lineItems.map((l: any) => ({
    label: text(l.label, 200),
    amount: amount(l.amount),
  }));
  const invoice: Invoice = {
    currency,
    lineItems,
    subtotal: amount(raw.subtotal),
    tax: amount(raw.tax),
    service: amount(raw.service),
    discount: amount(raw.discount),
    total: amount(raw.total),
    confidence: raw.confidence,
  };
  requireThat(
    typeof invoice.confidence === "number" &&
      Number.isFinite(invoice.confidence) &&
      invoice.confidence >= 0 &&
      invoice.confidence <= 1,
    "invalid_confidence",
  );
  const issues: string[] = [];
  if (currency !== "dUSD") issues.push("currency_requires_manual_conversion");
  if (
    lineItems.reduce((n, l) => n + BigInt(l.amount), 0n) !==
    BigInt(invoice.subtotal)
  )
    issues.push("subtotal_mismatch");
  if (
    BigInt(invoice.subtotal) +
      BigInt(invoice.tax) +
      BigInt(invoice.service) -
      BigInt(invoice.discount) !==
    BigInt(invoice.total)
  )
    issues.push("total_mismatch");
  if (invoice.confidence < 0.9) issues.push("low_confidence");
  return {
    invoice,
    issues,
    requiresManualReview: issues.length > 0,
    confirmationRequired: true,
    canAutoPublish: false,
  };
}
export function equalSplit(total: string, count: number) {
  const n = BigInt(amount(total)),
    c = integer(count, 1, 5),
    q = n / BigInt(c),
    remainder = Number(n % BigInt(c));
  return {
    shares: Array.from({ length: c }, (_, i) =>
      (q + (i < remainder ? 1n : 0n)).toString(),
    ),
    remainder,
    rule: "first-members-receive-one-base-unit",
  };
}
export type OcrAdapter = {
  recipient: string;
  cloud: boolean;
  extract: (image: Buffer, signal: AbortSignal) => Promise<Record<string, any>>;
};
export async function extractInvoice(
  buffer: Buffer,
  mime: string,
  adapter?: OcrAdapter,
  consentRecipient?: string,
) {
  requireThat(
    buffer.length > 0 && buffer.length <= 10 * 1024 * 1024,
    "image_size_limit",
    undefined,
    413,
  );
  const metadata = await sharp(buffer, {
    limitInputPixels: 20000000,
  }).metadata();
  const types: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  requireThat(
    metadata.format && types[metadata.format] === mime,
    "image_mime_mismatch",
  );
  requireThat(
    metadata.width &&
      metadata.height &&
      metadata.width * metadata.height <= 20000000,
    "image_pixel_limit",
  );
  requireThat(
    adapter,
    "ocr_not_configured",
    "OCR is not configured; enter invoice manually",
    503,
  );
  requireThat(
    !adapter.cloud || consentRecipient === adapter.recipient,
    "ocr_consent_required",
    undefined,
    403,
  );
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      adapter.extract(buffer, controller.signal).then(validateInvoice),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("OCR timeout"));
        }, 15000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    buffer.fill(0);
  }
}
