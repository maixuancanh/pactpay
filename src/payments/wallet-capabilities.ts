export type Capability = { verified: boolean; evidence?: string; chainId?: number; account?: string; primitive?: 'native-batch-all' | 'smart-account'; atomic?: boolean; preservesOrigin?: boolean; oneAuthorization?: boolean };
export type WalletCapabilities = { google: Capability; eoaWrite: Capability; smartAccount: Capability; approveContribute: Capability; captureClaim: Capability; expiryClaim: Capability; sponsorExecution: Capability; sponsorStorage: Capability };
const unknown = (): Capability => ({ verified: false });
export const walletCapabilities: WalletCapabilities = { google: unknown(), eoaWrite: unknown(), smartAccount: unknown(), approveContribute: unknown(), captureClaim: unknown(), expiryClaim: unknown(), sponsorExecution: unknown(), sponsorStorage: unknown() };
export const commerceFeatureFlags = Object.freeze({ google: false, sponsoring: false, batching: false, protectedContract: false });
export function verifiedCapability(c: Capability, chainId: number, account?: string): boolean { return c.verified && !!c.evidence && c.chainId === chainId && (!account || c.account?.toLowerCase() === account.toLowerCase()); }
