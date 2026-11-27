import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IssueTrackerWriteFailure } from './issueTrackerWrites.js';

export type AzureServicesWorkItemWriteScope = {
	providerId: GitCloudHostIntegrationId.AzureDevOps;
	connectionId: string;
	organizationId: string;
	organizationName: string;
	projectId: string;
	/** The verified Azure profile ID, distinct from the organization-local member ID. */
	expectedAccountId?: string;
};

export type AzureServerWorkItemWriteScope = {
	providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	connectionId: string;
	/** Used only when the connection has no configured domain; it must come from trusted authentication configuration. */
	domain?: string;
	/** The collection's id (its `connectionData.instanceId`). */
	organizationId: string;
	/** The collection's name. */
	organizationName: string;
	/** The connection's configured API base (installation or collection address), as a write context returns it. */
	baseUrl: string;
	/** The collection's URL, as `listOrgs` returns it for the same connection. */
	collectionUrl: string;
	projectId: string;
	/** The collection's own `connectionData.authenticatedUser.id`, as a write context returns it as `accountId`. */
	expectedAccountId?: string;
};

export type WorkItemWriteScope = AzureServicesWorkItemWriteScope | AzureServerWorkItemWriteScope;

export type WorkItemAddress = WorkItemWriteScope & { workItemId: number };
export type WorkItemCreateOptions = WorkItemWriteScope & { workItemType?: string };
export type WorkItemWriteTargetOptions = WorkItemAddress & { intent?: 'delete' };
export type WorkItemDeleteOptions = WorkItemAddress & {
	expectedAccountId: string;
	expectedRevision: number;
};
export type WorkItemWriteOptions =
	| (WorkItemWriteScope & {
			action: 'create';
			expectedAccountId: string;
			workItemType: string;
			fields: Readonly<Record<string, unknown>>;
	  })
	| (WorkItemDeleteOptions & { action: 'edit'; fields: Readonly<Record<string, unknown>> })
	| (WorkItemDeleteOptions & { action: 'set-state'; state: string; fields?: Readonly<Record<string, unknown>> });

export type WorkItemWriteContext =
	| {
			providerId: GitCloudHostIntegrationId.AzureDevOps;
			connectionId: string;
			accountId: string;
			organization: { id: string; name: string };
			project: { id: string; name: string };
	  }
	| {
			providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer;
			connectionId: string;
			baseUrl: string;
			accountId: string;
			organization: { id: string; name: string; url: string };
			project: { id: string; name: string };
	  };

export type WorkItemState = { name: string; category: string; color?: string };
export type WorkItemWriteField = {
	referenceName: string;
	name: string;
	type: string;
	required: boolean;
	allowedValues?: readonly unknown[];
	defaultValue?: unknown;
	helpText?: string;
};
export type WorkItemReceipt = {
	id: number;
	revision: number;
	url: string;
	type: string;
	title: string;
	state: Pick<WorkItemState, 'name' | 'category'>;
	bodyField?: string;
};
export type WorkItemDeleteCapability =
	| { allowed: true }
	| { allowed: false; reason: 'forbidden' | 'insufficient-scope' | 'unsupported' }
	| { allowed: 'unknown' };

export type WorkItemCreateOptionsResult =
	| IssueTrackerWriteFailure
	| (WorkItemWriteContext & { ok: true } & (
				| { workItemTypes: readonly { name: string }[] }
				| {
						workItemType: string;
						fields: readonly WorkItemWriteField[];
						states: readonly WorkItemState[];
						initialStates: readonly WorkItemState[];
						bodyField?: string;
				  }
			));

type WorkItemWriteSuccess = WorkItemWriteContext & { ok: true; issue: WorkItemReceipt };

export type WorkItemWriteResult = IssueTrackerWriteFailure | WorkItemWriteSuccess;
export type WorkItemWriteOptionsResult =
	| IssueTrackerWriteFailure
	| (WorkItemWriteSuccess & {
			fields: readonly WorkItemWriteField[];
			availableStates: readonly WorkItemState[];
			deleteCapability: WorkItemDeleteCapability;
			bodyField?: string;
	  });
export type WorkItemWriteTargetResult =
	| IssueTrackerWriteFailure
	| (WorkItemWriteSuccess & { deleteCapability?: WorkItemDeleteCapability });
export type WorkItemDeletion = {
	disposition: 'recycle-bin';
	restorable: true;
	revision?: number;
	deletedAt?: string;
};
export type WorkItemDeleteTargetChanged = WorkItemWriteContext & {
	ok: false;
	reason: 'target-changed';
	applied: true;
	deleted: { id: number; revision?: number; project: { id?: string; name: string } };
	deletion: WorkItemDeletion;
};
export type WorkItemDeleteResult =
	| IssueTrackerWriteFailure
	| WorkItemDeleteTargetChanged
	| (WorkItemWriteSuccess & { deletion: WorkItemDeletion & { revision: number } });
