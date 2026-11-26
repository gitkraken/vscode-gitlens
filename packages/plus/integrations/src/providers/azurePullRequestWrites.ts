import type {
	AzurePullRequestCreateCapabilityOptions,
	AzurePullRequestCreateCapabilityResult,
	AzurePullRequestMergeStrategy,
	AzurePullRequestRepository,
	AzurePullRequestWriteFailure,
	AzurePullRequestWriteOptions,
	AzurePullRequestWriteResult,
	AzurePullRequestWriteTargetResult,
	AzureWrittenPullRequest,
} from '../models/azurePullRequestWrites.js';
import type { AzurePullRequest, AzureRepository } from './azure/models.js';
import { encodeAzurePathSegment, getAzurePullRequestWebUrl } from './azure/models.js';
import {
	getAzureWriteOrganizations,
	getAzureWriteProfile,
	isAzureGuid,
	isAzureIdentifier,
	isAzurePositiveInt,
	sameAzureIdentifier,
} from './azure/writeIdentity.js';
import { AzurePullRequestWriteError, toAzurePullRequestWriteFailure } from './azurePullRequestWriteErrors.js';
import type { ProviderRequestFunction } from './models.js';

const azureBaseUrl = 'https://dev.azure.com';
const branchRefPrefix = 'refs/heads/';
const mergeStrategyPolicyId = 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab';
const strategySettings = {
	noFastForward: 'allowNoFastForward',
	squash: 'allowSquash',
	rebase: 'allowRebase',
	rebaseMerge: 'allowRebaseMerge',
} as const;
const mergeStrategies: AzurePullRequestMergeStrategy[] = ['noFastForward', 'squash', 'rebase', 'rebaseMerge'];

type MergePolicy = {
	isEnabled?: boolean;
	isDeleted?: boolean;
	isBlocking?: boolean;
	settings?: Partial<Record<(typeof strategySettings)[AzurePullRequestMergeStrategy] | 'useSquashMerge', boolean>>;
};

type CompletionCapability = Extract<AzurePullRequestWriteTargetResult, { ok: true }>['capabilities']['complete'];
type CompletionOptions = Extract<AzurePullRequestWriteOptions, { action: 'complete' }>;
type FailureReason = AzurePullRequestWriteFailure['reason'];
type PullRequestSnapshot = Omit<AzureWrittenPullRequest, 'state'> & {
	state: AzureWrittenPullRequest['state'] | undefined;
};
type WriteStatus = Extract<AzurePullRequestWriteResult, { ok: true }>['status'];

function isPathSegment(value: unknown): value is string {
	return isAzureIdentifier(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');
}

function isBranchRef(ref: unknown): ref is string {
	return (
		typeof ref === 'string' &&
		ref.startsWith(branchRefPrefix) &&
		ref.length > branchRefPrefix.length &&
		![...ref].some(character => character <= ' ' || '~^:?*[\\\x7f'.includes(character)) &&
		!ref.includes('..') &&
		!ref.includes('@{') &&
		!ref.endsWith('.') &&
		ref.split('/').every(part => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'))
	);
}

function isCommitId(sha: unknown): sha is string {
	return typeof sha === 'string' && /^(?!0{40}$)[0-9a-f]{40}$/i.test(sha);
}

export function isAzurePullRequestScope(options: AzurePullRequestCreateCapabilityOptions): boolean {
	return (
		isAzureIdentifier(options.connectionId) &&
		typeof options.organization === 'string' &&
		/^[a-z0-9][a-z0-9-]*$/i.test(options.organization) &&
		isPathSegment(options.project) &&
		isPathSegment(options.repository) &&
		(options.expectedAccountId === undefined || isAzureIdentifier(options.expectedAccountId))
	);
}

function isTitle(title: unknown): title is string {
	return typeof title === 'string' && title.trim().length > 0;
}

function isDescription(description: unknown): boolean {
	return description === undefined || (typeof description === 'string' && description.length <= 4000);
}

export function isAzurePullRequestWrite(options: AzurePullRequestWriteOptions): boolean {
	if (
		!isAzureGuid(options.projectId) ||
		!isAzureGuid(options.repositoryId) ||
		!isAzureIdentifier(options.expectedAccountId)
	) {
		return false;
	}

	if (options.action === 'create') {
		return (
			isBranchRef(options.sourceRef) &&
			isBranchRef(options.targetRef) &&
			options.sourceRef !== options.targetRef &&
			isTitle(options.title) &&
			isDescription(options.description)
		);
	}

	if (!isAzurePositiveInt(options.number)) return false;

	switch (options.action) {
		case 'edit':
			return (
				(options.title !== undefined || options.description !== undefined) &&
				(options.title === undefined || isTitle(options.title)) &&
				isDescription(options.description)
			);
		case 'abandon':
		case 'reactivate':
			return true;
		case 'complete':
			return (
				mergeStrategies.includes(options.strategy) &&
				isBranchRef(options.expectedSourceRef) &&
				isBranchRef(options.expectedTargetRef) &&
				options.expectedSourceRef !== options.expectedTargetRef &&
				isCommitId(options.expectedSourceSha) &&
				isCommitId(options.expectedTargetSha)
			);
		default:
			return false;
	}
}

function allowsStrategy(policy: MergePolicy, strategy: AzurePullRequestMergeStrategy): boolean {
	const settings = policy.settings;
	if (settings == null) return false;
	if (mergeStrategies.some(type => settings[strategySettings[type]] != null)) {
		return settings[strategySettings[strategy]] === true;
	}

	return (
		(strategy === 'squash' && settings.useSquashMerge === true) ||
		(strategy === 'noFastForward' && settings.useSquashMerge === false)
	);
}

function getCompletionRefFailure(
	options: CompletionOptions,
	pullRequest: AzureWrittenPullRequest,
): FailureReason | undefined {
	if (
		pullRequest.sourceRef !== options.expectedSourceRef ||
		!sameAzureIdentifier(pullRequest.sourceSha, options.expectedSourceSha)
	) {
		return 'source-changed';
	}
	if (
		pullRequest.targetRef !== options.expectedTargetRef ||
		!sameAzureIdentifier(pullRequest.targetSha, options.expectedTargetSha)
	) {
		return 'target-changed';
	}
	return undefined;
}

function getCompletionStateFailure(raw: AzurePullRequest): FailureReason | undefined {
	if (raw.forkSource != null) return 'unsupported';
	if (raw.isDraft) return 'policy-blocked';
	if (raw.status !== 'active' || raw.mergeStatus === 'conflicts' || raw.mergeStatus === 'queued') return 'conflict';
	if (raw.mergeStatus === 'failure') return 'unknown';

	return undefined;
}

function getReportedMergeFailure(mergeStatus: AzurePullRequest['mergeStatus']): FailureReason | undefined {
	switch (mergeStatus) {
		case 'rejectedByPolicy':
			return 'policy-blocked';
		case 'conflicts':
			return 'conflict';
		case 'failure':
			return 'unknown';
		default:
			return undefined;
	}
}

export class AzurePullRequestWriter {
	static async connect(
		request: ProviderRequestFunction,
		credential: { accessToken: string; accountsAuthorization: string; gitAuthorization: string },
		options: AzurePullRequestCreateCapabilityOptions,
		isSessionCurrent: () => Promise<boolean>,
	): Promise<AzurePullRequestWriter> {
		const { body: profile } = await getAzureWriteProfile(request, credential.accessToken);
		const accountId = profile?.id;
		if (
			!isAzureIdentifier(accountId) ||
			(options.expectedAccountId !== undefined && !sameAzureIdentifier(accountId, options.expectedAccountId))
		) {
			throw new AzurePullRequestWriteError('no-connection');
		}

		const { body: accounts } = await getAzureWriteOrganizations(
			request,
			credential.accountsAuthorization,
			accountId,
		);
		if (!Array.isArray(accounts?.value)) throw new AzurePullRequestWriteError('unknown');

		const organization = accounts.value.find(account =>
			sameAzureIdentifier(account?.accountName, options.organization),
		)?.accountName;
		if (organization == null) throw new AzurePullRequestWriteError('not-found');

		const headers = { Authorization: credential.gitAuthorization };
		const { body: repo } = await request<AzureRepository>({
			url: `${azureBaseUrl}/${organization}/${encodeAzurePathSegment(options.project)}/_apis/git/repositories/${encodeAzurePathSegment(options.repository)}?api-version=7.1`,
			headers: headers,
			redirect: 'error',
		});
		if (
			!isAzureGuid(repo?.id) ||
			!isAzureGuid(repo.project?.id) ||
			!isPathSegment(repo.name) ||
			!isPathSegment(repo.project.name) ||
			!sameAzureIdentifier(isAzureGuid(options.repository) ? repo.id : repo.name, options.repository) ||
			!sameAzureIdentifier(isAzureGuid(options.project) ? repo.project.id : repo.project.name, options.project)
		) {
			throw new AzurePullRequestWriteError('not-found');
		}
		if (repo.isDisabled || repo.isInMaintenance) throw new AzurePullRequestWriteError('unsupported');

		return new AzurePullRequestWriter(
			request,
			headers,
			accountId,
			{
				organization: organization,
				projectId: repo.project.id,
				projectName: repo.project.name,
				repositoryId: repo.id,
				repositoryName: repo.name,
			},
			isSessionCurrent,
		);
	}

	private readonly gitApiUrl: string;
	private readonly repoUrl: string;

	private constructor(
		private readonly request: ProviderRequestFunction,
		private readonly headers: { Authorization: string },
		private readonly accountId: string,
		private readonly repository: AzurePullRequestRepository,
		private readonly isSessionCurrent: () => Promise<boolean>,
	) {
		this.gitApiUrl = `${azureBaseUrl}/${repository.organization}/${repository.projectId}/_apis/git`;
		this.repoUrl = `${this.gitApiUrl}/repositories/${repository.repositoryId}`;
	}

	getCreateCapability(): AzurePullRequestCreateCapabilityResult {
		return { ok: true, accountId: this.accountId, repository: this.repository };
	}

	async resolveTarget(number: number): Promise<AzurePullRequestWriteTargetResult> {
		if (!isAzurePositiveInt(number)) return { ok: false, reason: 'invalid-input' };

		const { raw, pullRequest } = await this.readPullRequest(number);
		const state = raw.status;
		return {
			ok: true,
			accountId: this.accountId,
			pullRequest: pullRequest,
			capabilities: {
				edit: state === 'active' || state === 'abandoned',
				abandon: state === 'active',
				reactivate: state === 'abandoned',
				complete: await this.getCompletionCapability(raw, pullRequest),
			},
		};
	}

	async write(options: AzurePullRequestWriteOptions): Promise<AzurePullRequestWriteResult> {
		if (options.action === 'create') {
			return this.save(options, {
				sourceRefName: options.sourceRef,
				targetRefName: options.targetRef,
				title: options.title,
				description: options.description,
			});
		}

		const current = await this.readPullRequest(options.number);
		const state = current.raw.status;
		switch (options.action) {
			case 'edit':
				if (state === 'completed') return { ok: false, reason: 'conflict' };

				return this.save(options, { title: options.title, description: options.description });
			case 'abandon':
				if (state !== 'active') return { ok: false, reason: 'conflict' };

				return this.save(options, { status: 'abandoned' });
			case 'reactivate':
				if (state !== 'abandoned') return { ok: false, reason: 'conflict' };

				return this.save(options, { status: 'active' });
			case 'complete':
				return this.complete(options, current.raw, current.pullRequest);
		}
	}

	private async complete(
		options: CompletionOptions,
		raw: AzurePullRequest,
		pullRequest: AzureWrittenPullRequest,
	): Promise<AzurePullRequestWriteResult> {
		const refFailure = getCompletionRefFailure(options, pullRequest);
		if (refFailure != null) return { ok: false, reason: refFailure };

		const capability = await this.getCompletionCapability(raw, pullRequest, options.strategy);
		if (capability.kind === 'unavailable') return { ok: false, reason: capability.reason };

		const latest = await this.readPullRequest(options.number);
		const latestFailure =
			getCompletionRefFailure(options, latest.pullRequest) ?? getCompletionStateFailure(latest.raw);
		if (latestFailure != null) return { ok: false, reason: latestFailure };

		return this.save(options, {
			status: 'completed',
			completionOptions: { mergeStrategy: options.strategy, bypassPolicy: false },
			lastMergeSourceCommit: { commitId: options.expectedSourceSha },
		});
	}

	private async getCompletionCapability(
		raw: AzurePullRequest,
		pullRequest: AzureWrittenPullRequest,
		strategy?: AzurePullRequestMergeStrategy,
	): Promise<CompletionCapability> {
		const stateFailure = getCompletionStateFailure(raw);
		if (stateFailure != null) return { kind: 'unavailable', reason: stateFailure };
		if (!pullRequest.sourceSha || !pullRequest.targetSha) return { kind: 'unavailable', reason: 'unknown' };

		try {
			const strategies = await this.getAllowedStrategies(pullRequest.targetRef);
			if (!strategies.length || (strategy != null && !strategies.includes(strategy))) {
				return { kind: 'unavailable', reason: 'policy-blocked' };
			}

			const [source, target] = await Promise.all([
				this.readRef(pullRequest.sourceRef),
				this.readRef(pullRequest.targetRef),
			]);
			if (!sameAzureIdentifier(source, pullRequest.sourceSha)) {
				return { kind: 'unavailable', reason: 'source-changed' };
			}
			if (!sameAzureIdentifier(target, pullRequest.targetSha)) {
				return { kind: 'unavailable', reason: 'target-changed' };
			}

			return { kind: 'available', strategies: strategies };
		} catch (ex) {
			return { kind: 'unavailable', reason: toAzurePullRequestWriteFailure(ex).reason };
		}
	}

	private async getAllowedStrategies(ref: string): Promise<AzurePullRequestMergeStrategy[]> {
		const query = new URLSearchParams({
			'api-version': '7.1',
			repositoryId: this.repository.repositoryId,
			refName: ref,
			policyType: mergeStrategyPolicyId,
		});
		let strategies = mergeStrategies.slice();
		for await (const policies of this.readPages<MergePolicy>(`${this.gitApiUrl}/policy/configurations`, query)) {
			for (const policy of policies) {
				if (policy.isEnabled === true && policy.isDeleted !== true && policy.isBlocking === true) {
					strategies = strategies.filter(strategy => allowsStrategy(policy, strategy));
				}
			}
		}
		return strategies;
	}

	private async readRef(ref: string): Promise<string | undefined> {
		const query = new URLSearchParams({ 'api-version': '7.1', filter: ref.slice('refs/'.length) });
		for await (const refs of this.readPages<{ name: string; objectId: string }>(`${this.repoUrl}/refs`, query)) {
			const match = refs.find(row => row.name === ref);
			if (match != null) return isCommitId(match.objectId) ? match.objectId : undefined;
		}
		return undefined;
	}

	private async *readPages<T>(url: string, query: URLSearchParams): AsyncGenerator<T[]> {
		const seen = new Set<string>();
		while (true) {
			const { body, headers } = await this.request<{ value?: T[] }>({
				url: `${url}?${query.toString()}`,
				headers: this.headers,
				redirect: 'error',
			});
			if (!Array.isArray(body?.value)) throw new AzurePullRequestWriteError('unknown');

			yield body.value;

			const next = headers['x-ms-continuationtoken'];
			if (!next) return;
			if (seen.has(next)) throw new AzurePullRequestWriteError('unknown');

			seen.add(next);
			query.set('continuationToken', next);
		}
	}

	private async readPullRequest(
		number: number,
	): Promise<{ raw: AzurePullRequest; pullRequest: AzureWrittenPullRequest }> {
		const { body: raw } = await this.request<AzurePullRequest>({
			url: this.pullRequestUrl(number),
			headers: this.headers,
			redirect: 'error',
		});
		const snapshot = this.toPullRequestSnapshot(raw, number);
		const { state } = snapshot;
		if (state === undefined) {
			throw new AzurePullRequestWriteError(getReportedMergeFailure(raw.mergeStatus) ?? 'unknown');
		}
		return { raw: raw, pullRequest: { ...snapshot, state: state } };
	}

	private pullRequestUrl(number?: number): string {
		return `${this.repoUrl}/pullrequests${number === undefined ? '' : `/${number}`}?api-version=7.1`;
	}

	private toPullRequestSnapshot(raw: AzurePullRequest, number?: number): PullRequestSnapshot {
		if (
			!sameAzureIdentifier(raw?.repository?.id, this.repository.repositoryId) ||
			!sameAzureIdentifier(raw.repository.project?.id, this.repository.projectId) ||
			(number !== undefined && raw.pullRequestId !== number)
		) {
			throw new AzurePullRequestWriteError('not-found');
		}

		if (
			!isAzurePositiveInt(raw.pullRequestId) ||
			(raw.status !== 'active' && raw.status !== 'abandoned' && raw.status !== 'completed') ||
			typeof raw.title !== 'string' ||
			(raw.description != null && typeof raw.description !== 'string') ||
			!isBranchRef(raw.sourceRefName) ||
			!isBranchRef(raw.targetRefName)
		) {
			throw new AzurePullRequestWriteError('unknown');
		}

		const sourceSha = raw.lastMergeSourceCommit?.commitId;
		const targetSha = raw.lastMergeTargetCommit?.commitId;
		let state: PullRequestSnapshot['state'] = raw.status;
		if (state === 'completed' && raw.mergeStatus !== 'succeeded') {
			state = raw.mergeStatus === 'queued' ? 'active' : undefined;
		}
		return {
			repository: this.repository,
			number: raw.pullRequestId,
			url: getAzurePullRequestWebUrl(
				{
					pullRequestId: raw.pullRequestId,
					repository: {
						...raw.repository,
						name: this.repository.repositoryName,
						project: { id: this.repository.projectId, name: this.repository.projectName },
					},
				},
				azureBaseUrl,
				this.repository.organization,
			),
			title: raw.title,
			description: raw.description ?? '',
			state: state,
			sourceRef: raw.sourceRefName,
			targetRef: raw.targetRefName,
			sourceSha: isCommitId(sourceSha) ? sourceSha : undefined,
			targetSha: isCommitId(targetSha) ? targetSha : undefined,
		};
	}

	private async save(options: AzurePullRequestWriteOptions, body: object): Promise<AzurePullRequestWriteResult> {
		if (!(await this.isSessionCurrent())) return { ok: false, reason: 'no-connection' };

		const create = options.action === 'create';
		const number = create ? undefined : options.number;
		let raw: AzurePullRequest;
		try {
			({ body: raw } = await this.request<AzurePullRequest>({
				url: this.pullRequestUrl(number),
				method: create ? 'POST' : 'PATCH',
				headers: { ...this.headers, 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				redirect: 'error',
			}));
		} catch (ex) {
			return toAzurePullRequestWriteFailure(ex, { complete: options.action === 'complete' });
		}

		let snapshot: PullRequestSnapshot;
		try {
			snapshot = this.toPullRequestSnapshot(raw, number);
		} catch {
			return { ok: false, reason: 'outcome-unknown' };
		}

		return this.getReceipt(options, raw, snapshot);
	}

	private getReceipt(
		options: AzurePullRequestWriteOptions,
		raw: AzurePullRequest,
		snapshot: PullRequestSnapshot,
	): AzurePullRequestWriteResult {
		const { state, sourceRef, targetRef } = snapshot;
		let status: WriteStatus | undefined;
		switch (options.action) {
			case 'create':
				if (state === 'active' && sourceRef === options.sourceRef && targetRef === options.targetRef) {
					status = 'created';
				}
				break;
			case 'edit':
				if (
					(options.title === undefined || snapshot.title === options.title) &&
					(options.description === undefined || snapshot.description === options.description)
				) {
					status = 'updated';
				}
				break;
			case 'abandon':
				if (state === 'abandoned') {
					status = 'abandoned';
				}
				break;
			case 'reactivate':
				if (state === 'active') {
					status = 'reactivated';
				}
				break;
			case 'complete': {
				if (sourceRef !== options.expectedSourceRef || targetRef !== options.expectedTargetRef) break;

				const failure = getReportedMergeFailure(raw.mergeStatus);
				if (failure != null) return { ok: false, reason: failure };

				if (state === 'active' && raw.mergeStatus === 'queued') {
					status = 'pending';
				} else if (state === 'completed') {
					status = 'completed';
				}
				break;
			}
		}

		return status === undefined || state === undefined
			? { ok: false, reason: 'outcome-unknown' }
			: { ok: true, status: status, pullRequest: { ...snapshot, state: state } };
	}
}
