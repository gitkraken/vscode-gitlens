import type { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { AzureServerWorkItemWriteScope } from './workItemWrites.js';

export type AzurePullRequestMergeStrategy = 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge';

export type AzurePullRequestRepository = {
	organization: string;
	/** Present for Server receipts; collection identity is independent of its name. */
	server?: {
		providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		connectionId: string;
		baseUrl: string;
		collectionUrl: string;
		organizationId: string;
	};
	projectId: string;
	projectName: string;
	repositoryId: string;
	repositoryName: string;
};

export type AzureWrittenPullRequest = {
	repository: AzurePullRequestRepository;
	number: number;
	url: string;
	title: string;
	description: string;
	state: 'active' | 'abandoned' | 'completed';
	sourceRef: string;
	targetRef: string;
	sourceSha?: string;
	targetSha?: string;
};

export type AzurePullRequestWriteFailure = {
	ok: false;
	reason:
		| 'unsupported'
		| 'no-connection'
		| 'forbidden'
		| 'not-found'
		| 'invalid-input'
		| 'rate-limit'
		| 'conflict'
		| 'policy-blocked'
		| 'source-changed'
		| 'target-changed'
		| 'unknown'
		| 'outcome-unknown';
};

export type AzurePullRequestCreateCapabilityOptions = {
	providerId?: GitCloudHostIntegrationId.AzureDevOps;
	connectionId: string;
	organization: string;
	project: string;
	repository: string;
	expectedAccountId?: string;
};

export type AzureServerPullRequestWriteScope = AzureServerWorkItemWriteScope & { repository: string };

export type AzurePullRequestCreateCapabilityResult =
	| { ok: true; repository: AzurePullRequestRepository; accountId: string }
	| AzurePullRequestWriteFailure;

export type AzurePullRequestWriteTargetOptions = AzurePullRequestCreateCapabilityOptions & { number: number };

export type AzureServerPullRequestWriteTargetOptions = AzureServerPullRequestWriteScope & { number: number };

export type AzurePullRequestWriteTargetResult =
	| {
			ok: true;
			accountId: string;
			pullRequest: AzureWrittenPullRequest;
			capabilities: {
				edit: boolean;
				abandon: boolean;
				reactivate: boolean;
				complete:
					| { kind: 'available'; strategies: AzurePullRequestMergeStrategy[] }
					| { kind: 'unavailable'; reason: AzurePullRequestWriteFailure['reason'] };
			};
	  }
	| AzurePullRequestWriteFailure;

export type AzurePullRequestWriteAction =
	| { action: 'create'; sourceRef: string; targetRef: string; title: string; description?: string }
	| { action: 'edit'; number: number; title?: string; description?: string }
	| { action: 'abandon' | 'reactivate'; number: number }
	| {
			action: 'complete';
			number: number;
			strategy: AzurePullRequestMergeStrategy;
			expectedSourceRef: string;
			expectedTargetRef: string;
			expectedSourceSha: string;
			expectedTargetSha: string;
	  };

export type AzurePullRequestWriteOptions = {
	providerId?: GitCloudHostIntegrationId.AzureDevOps;
	connectionId: string;
	expectedAccountId: string;
	organization: string;
	projectId: string;
	repositoryId: string;
} & AzurePullRequestWriteAction;

export type AzureServerPullRequestWriteOptions = Omit<AzureServerPullRequestWriteScope, 'repository'> & {
	repositoryId: string;
	expectedAccountId: string;
} & AzurePullRequestWriteAction;

export type AzurePullRequestWriteResult =
	| {
			ok: true;
			status: 'created' | 'updated' | 'abandoned' | 'reactivated' | 'completed' | 'pending';
			pullRequest: AzureWrittenPullRequest;
	  }
	| AzurePullRequestWriteFailure;
