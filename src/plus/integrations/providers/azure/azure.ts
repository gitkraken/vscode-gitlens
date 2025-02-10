import type { HttpsProxyAgent } from 'https-proxy-agent';
import type { CancellationToken, Disposable } from 'vscode';
import { window } from 'vscode';
import type { RequestInit, Response } from '@env/fetch';
import { fetch, getProxyAgent, wrapForForcedInsecureSSL } from '@env/fetch';
import { isWeb } from '@env/platform';
import type { Container } from '../../../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	CancellationError,
	ProviderFetchError,
	RequestClientError,
	RequestNotFoundError,
} from '../../../../errors';
import type { Issue } from '../../../../git/models/issue';
import type { IssueOrPullRequest } from '../../../../git/models/issueOrPullRequest';
import type { PullRequest } from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';
import { showIntegrationRequestFailed500WarningMessage } from '../../../../messages';
import { configuration } from '../../../../system/-webview/configuration';
import { debug } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import type { LogScope } from '../../../../system/logger.scope';
import { getLogScope } from '../../../../system/logger.scope';
import { maybeStopWatch } from '../../../../system/stopwatch';
import type {
	AzureProjectDescriptor,
	AzurePullRequest,
	AzurePullRequestWithLinks,
	AzureWorkItemState,
	AzureWorkItemStateCategory,
	WorkItem,
} from './models';
import {
	azurePullRequestStatusToState,
	azureWorkItemsStateCategoryToState,
	fromAzurePullRequest,
	fromAzureWorkItem,
	getAzurePullRequestWebUrl,
	isClosedAzurePullRequestStatus,
	isClosedAzureWorkItemStateCategory,
} from './models';

export class AzureDevOpsApi implements Disposable {
	private readonly _disposable: Disposable;
	private _workItemStates: WorkItemStates = new WorkItemStates();

	constructor(_container: Container) {
		this._disposable = configuration.onDidChangeAny(e => {
			if (
				configuration.changedCore(e, ['http.proxy', 'http.proxyStrictSSL']) ||
				configuration.changed(e, ['outputLevel', 'proxy'])
			) {
				this.resetCaches();
			}
		});
	}

	dispose(): void {
		this._disposable.dispose();
	}

	private _proxyAgent: HttpsProxyAgent | null | undefined = null;
	private get proxyAgent(): HttpsProxyAgent | undefined {
		if (isWeb) return undefined;

		if (this._proxyAgent === null) {
			this._proxyAgent = getProxyAgent();
		}
		return this._proxyAgent;
	}

	private resetCaches(): void {
		this._proxyAgent = null;
		this._workItemStates.clear();
	}

	@debug<AzureDevOpsApi['getPullRequestForBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
	public async getPullRequestForBranch(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		branch: string,
		options: {
			baseUrl: string;
		},
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();
		const [projectName, _, repoName] = repo.split('/');

		try {
			const prResult = await this.request<{ value: AzurePullRequest[] }>(
				provider,
				token,
				options?.baseUrl,
				`${owner}/${projectName}/_apis/git/repositories/${repoName}/pullRequests`,
				{
					method: 'GET',
				},
				scope,
			);

			const pr = prResult?.value.find(pr => pr.sourceRefName.endsWith(branch));
			if (pr == null) return undefined;

			return fromAzurePullRequest(pr, provider, owner, projectName);
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@debug<AzureDevOpsApi['getIssueOrPullRequest']>({ args: { 0: p => p.name, 1: '<token>' } })
	public async getIssueOrPullRequest(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		id: string,
		options: {
			baseUrl: string;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();
		const [projectName, _, repoName] = repo.split('/');

		try {
			// Try to get the Work item (wit) first with specific fields
			const issueResult = await this.request<WorkItem>(
				provider,
				token,
				options?.baseUrl,
				`${owner}/${projectName}/_apis/wit/workItems/${id}`,
				{
					method: 'GET',
				},
				scope,
			);

			if (issueResult != null) {
				const issueType = issueResult.fields['System.WorkItemType'];
				const state = issueResult.fields['System.State'];
				const stateCategory = await this.getWorkItemStateCategory(
					issueType,
					state,
					provider,
					token,
					owner,
					projectName,
					options,
				);

				return {
					id: issueResult.id.toString(),
					type: 'issue',
					nodeId: issueResult.id.toString(),
					provider: provider,
					createdDate: new Date(issueResult.fields['System.CreatedDate']),
					updatedDate: new Date(issueResult.fields['System.ChangedDate']),
					state: azureWorkItemsStateCategoryToState(stateCategory),
					closed: isClosedAzureWorkItemStateCategory(stateCategory),
					title: issueResult.fields['System.Title'],
					url: issueResult._links.html.href,
				};
			}
		} catch (ex) {
			if (ex.original?.status !== 404) {
				Logger.error(ex, scope);
				return undefined;
			}
		}

		try {
			const prResult = await this.request<AzurePullRequestWithLinks>(
				provider,
				token,
				options?.baseUrl,
				`${owner}/${projectName}/_apis/git/repositories/${repoName}/pullRequests/${id}`,
				{
					method: 'GET',
				},
				scope,
			);

			if (prResult != null) {
				return {
					id: prResult.pullRequestId.toString(),
					type: 'pullrequest',
					nodeId: prResult.pullRequestId.toString(), // prResult.artifactId maybe?
					provider: provider,
					createdDate: new Date(prResult.creationDate),
					updatedDate: new Date(prResult.creationDate),
					state: azurePullRequestStatusToState(prResult.status),
					closed: isClosedAzurePullRequestStatus(prResult.status),
					title: prResult.title,
					url: getAzurePullRequestWebUrl(prResult),
				};
			}

			return undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@debug<AzureDevOpsApi['getIssue']>({ args: { 0: p => p.name, 1: '<token>' } })
	public async getIssue(
		provider: Provider,
		token: string,
		project: AzureProjectDescriptor,
		id: string,
		options: {
			baseUrl: string;
		},
	): Promise<Issue | undefined> {
		const scope = getLogScope();

		try {
			// Try to get the Work item (wit) first with specific fields
			const issueResult = await this.request<WorkItem>(
				provider,
				token,
				options?.baseUrl,
				`${project.resourceName}/${project.name}/_apis/wit/workItems/${id}`,
				{
					method: 'GET',
				},
				scope,
			);

			if (issueResult != null) {
				const issueType = issueResult.fields['System.WorkItemType'];
				const state = issueResult.fields['System.State'];
				const stateCategory = await this.getWorkItemStateCategory(
					issueType,
					state,
					provider,
					token,
					project.resourceName,
					project.name,
					options,
				);
				return fromAzureWorkItem(issueResult, provider, project, stateCategory);
			}
		} catch (ex) {
			if (ex.original?.status !== 404) {
				Logger.error(ex, scope);
				return undefined;
			}
		}

		return undefined;
	}

	async getWorkItemStateCategory(
		issueType: string,
		state: string,
		provider: Provider,
		token: string,
		owner: string,
		projectName: string,
		options: {
			baseUrl: string;
		},
	): Promise<AzureWorkItemStateCategory | undefined> {
		const project = `${owner}/${projectName}`;
		const category = this._workItemStates.getStateCategory(project, issueType, state);
		if (category != null) return category;

		const states = await this.retrieveWorkItemTypeStates(issueType, provider, token, owner, projectName, options);
		this._workItemStates.saveTypeStates(project, issueType, states);

		return this._workItemStates.getStateCategory(project, issueType, state);
	}

	private async retrieveWorkItemTypeStates(
		workItemType: string,
		provider: Provider,
		token: string,
		owner: string,
		projectName: string,
		options: {
			baseUrl: string;
		},
	): Promise<AzureWorkItemState[]> {
		const scope = getLogScope();

		try {
			const issueResult = await this.request<{ value: AzureWorkItemState[]; count: number }>(
				provider,
				token,
				options?.baseUrl,
				`${owner}/${projectName}/_apis/wit/workItemTypes/${workItemType}/states`,
				{
					method: 'GET',
				},
				scope,
			);

			return issueResult?.value ?? [];
		} catch (ex) {
			Logger.error(ex, scope);
			return [];
		}
	}

	private async request<T>(
		provider: Provider,
		token: string,
		baseUrl: string,
		route: string,
		options: { method: RequestInit['method'] } & Record<string, unknown>,
		scope: LogScope | undefined,
		cancellation?: CancellationToken | undefined,
	): Promise<T | undefined> {
		const url = `${baseUrl}/${route}`;

		let rsp: Response;
		try {
			const sw = maybeStopWatch(`[AZURE] ${options?.method ?? 'GET'} ${url}`, { log: false });
			const agent = this.proxyAgent;

			try {
				let aborter: AbortController | undefined;
				if (cancellation != null) {
					if (cancellation.isCancellationRequested) throw new CancellationError();

					aborter = new AbortController();
					cancellation.onCancellationRequested(() => aborter!.abort());
				}

				rsp = await wrapForForcedInsecureSSL(provider.getIgnoreSSLErrors(), () =>
					fetch(url, {
						headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
						agent: agent,
						signal: aborter?.signal,
						...options,
					}),
				);

				if (rsp.ok) {
					const data: T = await rsp.json();
					return data;
				}

				throw new ProviderFetchError('AzureDevOps', rsp);
			} finally {
				sw?.stop();
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError || ex.name === 'AbortError') {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`AzureDevOps request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private handleRequestError(
		provider: Provider | undefined,
		_token: string,
		ex: ProviderFetchError | (Error & { name: 'AbortError' }),
		scope: LogScope | undefined,
	): void {
		if (ex.name === 'AbortError' || !(ex instanceof ProviderFetchError)) throw new CancellationError(ex);

		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new RequestNotFoundError(ex);
			case 401: // Unauthorized
				throw new AuthenticationError('azureDevOps', AuthenticationErrorReason.Unauthorized, ex);
			// TODO: Learn the Azure API docs and put it in order:
			// case 403: // Forbidden
			// 	if (ex.message.includes('rate limit')) {
			// 		let resetAt: number | undefined;

			// 		const reset = ex.response?.headers?.get('x-ratelimit-reset');
			// 		if (reset != null) {
			// 			resetAt = parseInt(reset, 10);
			// 			if (Number.isNaN(resetAt)) {
			// 				resetAt = undefined;
			// 			}
			// 		}

			// 		throw new RequestRateLimitError(ex, token, resetAt);
			// 	}
			// 	throw new AuthenticationError('azure', AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				Logger.error(ex, scope);
				if (ex.response != null) {
					provider?.trackRequestException();
					void showIntegrationRequestFailed500WarningMessage(
						`${provider?.name ?? 'AzureDevOps'} failed to respond and might be experiencing issues.${
							provider == null || provider.id === 'azure'
								? ' Please visit the [AzureDevOps status page](https://status.dev.azure.com) for more information.'
								: ''
						}`,
					);
				}
				return;
			case 502: // Bad Gateway
				Logger.error(ex, scope);
				// TODO: Learn the Azure API docs and put it in order:
				// if (ex.message.includes('timeout')) {
				// 	provider?.trackRequestException();
				// 	void showIntegrationRequestTimedOutWarningMessage(provider?.name ?? 'Azure');
				// 	return;
				// }
				break;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new RequestClientError(ex);
				break;
		}

		Logger.error(ex, scope);
		if (Logger.isDebugging) {
			void window.showErrorMessage(
				`AzureDevOps request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}
}

class WorkItemStates {
	private readonly _categories = new Map<string, AzureWorkItemStateCategory>();
	private readonly _types = new Map<string, AzureWorkItemState[]>();

	// TODO@sergeibbb: we might need some logic for invalidating
	public getStateCategory(
		project: string,
		workItemType: string,
		stateName: string,
	): AzureWorkItemStateCategory | undefined {
		return this._categories.get(this.getStateKey(project, workItemType, stateName));
	}

	public clear(): void {
		this._categories.clear();
		this._types.clear();
	}

	public saveTypeStates(project: string, workItemType: string, states: AzureWorkItemState[]): void {
		this.clearTypeStates(project, workItemType);
		this._types.set(this.getTypeKey(project, workItemType), states);
		for (const state of states) {
			this._categories.set(this.getStateKey(project, workItemType, state.name), state.category);
		}
	}

	public hasTypeStates(project: string, workItemType: string): boolean {
		return this._types.has(this.getTypeKey(project, workItemType));
	}

	private clearTypeStates(project: string, workItemType: string): void {
		const states = this._types.get(this.getTypeKey(project, workItemType));
		if (states == null) return;
		for (const state of states) {
			this._categories.delete(this.getStateKey(project, workItemType, state.name));
		}
	}

	private getStateKey(project: string, workItemType: string, stateName: string): string {
		// By stringifying the pair as JSON we make sure that all possible special characters are escaped
		return JSON.stringify([project, workItemType, stateName]);
	}

	private getTypeKey(project: string, workItemType: string): string {
		return JSON.stringify([project, workItemType]);
	}
}
