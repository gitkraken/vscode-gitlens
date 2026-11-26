export type AzurePullRequestMergeStrategy = 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge';

export type AzurePullRequestRepository = {
	organization: string;
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
	connectionId: string;
	organization: string;
	project: string;
	repository: string;
	expectedAccountId?: string;
};

export type AzurePullRequestCreateCapabilityResult =
	| { ok: true; repository: AzurePullRequestRepository; accountId: string }
	| AzurePullRequestWriteFailure;

export type AzurePullRequestWriteTargetOptions = AzurePullRequestCreateCapabilityOptions & { number: number };

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

export type AzurePullRequestWriteOptions = {
	connectionId: string;
	expectedAccountId: string;
	organization: string;
	projectId: string;
	repositoryId: string;
} & (
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
	  }
);

export type AzurePullRequestWriteResult =
	| {
			ok: true;
			status: 'created' | 'updated' | 'abandoned' | 'reactivated' | 'completed' | 'pending';
			pullRequest: AzureWrittenPullRequest;
	  }
	| AzurePullRequestWriteFailure;
