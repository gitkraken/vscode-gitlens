/**
 * @deprecated Import from `./actions/rpc.js` and `./events/subscriptions.js` instead.
 * This file re-exports for backwards compatibility during migration.
 */
export {
	entry,
	fireAndForget,
	fireRpc,
	noop,
	optimisticBatchFireAndForget,
	optimisticFireAndForget,
} from './actions/rpc.js';
export type { OptimisticEntry } from './actions/rpc.js';
export { subscribeAll } from './events/subscriptions.js';
export type { Unsubscribe } from './events/subscriptions.js';
