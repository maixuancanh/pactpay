export function errorCategory(message: string) {
  if (/reject|denied|4001/i.test(message)) return "WALLET_REJECTED";
  if (/insufficient|balance.*fee/i.test(message)) return "INSUFFICIENT_NATIVE";
  if (/pending|reconcile|unknown broadcast/i.test(message))
    return "PENDING_UNKNOWN";
  if (/account|authority|mapping/i.test(message)) return "WRONG_ACCOUNT";
  if (/partial|history/i.test(message)) return "EVIDENCE_PARTIAL";
  if (/fetch|rpc|timeout|http|websocket/i.test(message))
    return "RPC_UNAVAILABLE";
  return "UNCLASSIFIED";
}
export type DiagnosticInput = {
  error: string;
  version: string;
  contract?: string;
  quoteId?: string;
  actionCode?: string;
  runtimeVersion?: number;
  blockNumber?: string;
  transactionHash?: string;
};
export function diagnostics(input: DiagnosticInput, includePublicIds = false) {
  const actions = [
    "connect",
    "refresh",
    "create",
    "approve",
    "contribute",
    "withdrawContribution",
    "capture",
    "claim",
    "cancel",
    "expire",
    "mint",
    "deploy",
    "recover",
    "unknown",
  ];
  return {
    schema: "pactpay-diagnostics-v1",
    createdAt: new Date().toISOString(),
    appVersion: input.version.slice(0, 80),
    chainId: 420420777,
    errorCode: errorCategory(input.error),
    ...(actions.includes(input.actionCode ?? "")
      ? { actionCode: input.actionCode }
      : {}),
    ...(Number.isSafeInteger(input.runtimeVersion) && input.runtimeVersion! > 0
      ? { runtimeVersion: input.runtimeVersion }
      : {}),
    ...(/^\d{1,20}$/.test(input.blockNumber ?? "")
      ? { blockNumber: input.blockNumber }
      : {}),
    ...(includePublicIds &&
    /^0x[0-9a-f]{64}$/i.test(input.transactionHash ?? "")
      ? { transactionHash: input.transactionHash }
      : {}),
    ...(includePublicIds && /^0x[0-9a-f]{40}$/i.test(input.contract ?? "")
      ? { contract: input.contract }
      : {}),
    ...(includePublicIds && /^0x[0-9a-f]{64}$/i.test(input.quoteId ?? "")
      ? { quoteId: input.quoteId }
      : {}),
  };
}
