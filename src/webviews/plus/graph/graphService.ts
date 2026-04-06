import type { SharedWebviewServices } from '../../rpc/services/common.js';
import type { RpcEventSubscription } from '../../rpc/services/types.js';
import type { DidGetCountParams, DidGetSidebarDataParams, GraphSidebarPanel } from './protocol.js';

export interface GraphSidebarService {
	getSidebarData(panel: GraphSidebarPanel): Promise<DidGetSidebarDataParams>;
	getSidebarCounts(): Promise<DidGetCountParams>;
	toggleLayout(panel: GraphSidebarPanel): void;
	refresh(panel: GraphSidebarPanel): void;
	executeAction(command: string, context?: string): void;

	onSidebarInvalidated: RpcEventSubscription<undefined>;
	onWorktreeStateChanged: RpcEventSubscription<{ changes: Record<string, boolean | undefined> }>;
}

export interface GraphServices extends SharedWebviewServices {
	readonly sidebar: GraphSidebarService;
}
