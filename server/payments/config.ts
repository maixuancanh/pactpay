import {
  address,
  amount,
  integer,
  positive,
  requireThat,
  text,
} from "../lib.js";
import type { Row } from "../db/database.js";
export type ExecutionConfig = {
  rpcUrl: string;
  token: string;
  escrow: string;
  maxExecutionFee: string;
  maxStorageDeposit: string;
  maxWalletCreationFee: string;
  estimateTtlMs: number;
  rpcDecimals: number;
  nativeDecimals: number;
  denominationEvidence: string;
  accountCapabilities: Record<
    string,
    { verified: boolean; evidence: string; chainId: number; account: string }
  >;
};
export function validateExecutionConfig(
  raw: Row,
  chainId: number,
  localDevelopment = false,
): ExecutionConfig {
  const rpc = new URL(text(raw.rpcUrl, 2000));
  requireThat(
    !rpc.username &&
      !rpc.password &&
      !rpc.search &&
      (rpc.protocol === "https:" ||
        (localDevelopment && rpc.hostname === "127.0.0.1")),
    "public_rpc_must_be_safe",
  );
  requireThat(
    raw.accountCapabilities && typeof raw.accountCapabilities === "object",
    "account_capabilities_required",
  );
  const caps: ExecutionConfig["accountCapabilities"] = {};
  for (const [account, value] of Object.entries(raw.accountCapabilities)) {
    const key = address(account),
      c = value as Row;
    requireThat(
      c.verified === true &&
        c.chainId === chainId &&
        address(c.account) === key,
      "invalid_account_capability",
    );
    caps[key] = {
      verified: true,
      evidence: text(c.evidence, 4000),
      chainId,
      account: key,
    };
  }
  const config = {
    rpcUrl: rpc.href,
    token: address(raw.token),
    escrow: address(raw.escrow),
    maxExecutionFee: positive(raw.maxExecutionFee),
    maxStorageDeposit: amount(raw.maxStorageDeposit),
    maxWalletCreationFee: amount(raw.maxWalletCreationFee),
    estimateTtlMs: integer(raw.estimateTtlMs, 1000, 300000),
    rpcDecimals: integer(raw.rpcDecimals, 0, 36),
    nativeDecimals: integer(raw.nativeDecimals, 0, 36),
    denominationEvidence: text(raw.denominationEvidence, 4000),
    accountCapabilities: caps,
  };
  requireThat(
    config.rpcDecimals === config.nativeDecimals ||
      (chainId === 420420777 && config.rpcDecimals === 18 && config.nativeDecimals === 14),
    "denomination_adapter_required",
  );
  return config;
}
export function forAccount(
  config: ExecutionConfig | undefined,
  account: string | undefined,
) {
  if (!config || !account) return null;
  const capability = config.accountCapabilities[account.toLowerCase()];
  if (!capability) return null;
  const { accountCapabilities, ...publicConfig } = config;
  return { ...publicConfig, capability };
}
