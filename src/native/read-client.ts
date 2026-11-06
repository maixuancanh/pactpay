import { createPublicClient, fallback, http, webSocket, type Transport } from 'viem';

// Read client only. Native writes remain in the Polkadot.js adapter; this does not
// retry signed transactions, change chain identity, or authorize stale snapshots.
export function createNativeReadClient(transports: Transport[] = [
  http('https://test-evm-rpc-v3.portaldot.dev', { timeout: 10000, retryCount: 0 }),
  webSocket('wss://test-evm-rpc-v3.portaldot.dev', { timeout: 10000, retryCount: 0 }),
]) {
  return createPublicClient({
    transport: fallback(transports, { rank: false, retryCount: 0 }),
  });
}

export const nativeReadClient = createNativeReadClient();
