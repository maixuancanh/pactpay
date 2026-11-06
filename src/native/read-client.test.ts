import { expect, it, vi } from 'vitest';
import { custom } from 'viem';
import { createNativeReadClient } from './read-client';

it('recovers a failed HTTP read through the secondary transport', async () => {
  const primary = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
  const secondary = vi.fn().mockResolvedValue('0x2a');
  const client = createNativeReadClient([
    custom({request: primary}, {retryCount: 0}),
    custom({request: secondary}, {retryCount: 0}),
  ]);
  expect(await client.getBlockNumber()).toBe(42n);
  expect(primary).toHaveBeenCalled();
  expect(secondary).toHaveBeenCalled();
});

it('still rejects when both transports fail so stale reads cannot authorize payment', async () => {
  const client = createNativeReadClient([
    custom({request: async () => { throw Error('HTTP unavailable'); }}, {retryCount: 0}),
    custom({request: async () => { throw Error('WebSocket unavailable'); }}, {retryCount: 0}),
  ]);
  await expect(client.getBlockNumber()).rejects.toThrow();
});
