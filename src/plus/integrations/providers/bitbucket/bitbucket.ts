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
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../../git/models/issueOrPullRequest';
import type { PullRequest } from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';
import type { RepositoryMetadata } from '../../../../git/models/repositoryMetadata';
import { showIntegrationRequestFailed500WarningMessage } from '../../../../messages';
import { configuration } from '../../../../system/-webview/configuration';
import { debug } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import type { LogScope } from '../../../../system/logger.scope';
import { getLogScope } from '../../../../system/logger.scope';
import { maybeStopWatch } from '../../../../system/stopwatch';
import type { BitbucketIssue, BitbucketPullRequest, BitbucketRepository } from './models';
import { bitbucketIssueStateToState, fromBitbucketIssue, fromBitbucketPullRequest } from './models';

export class BitbucketApi implements Disposable {
	private readonly _disposable: Disposable;

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
	}

	@debug<BitbucketApi['getPullRequestForBranch']>({ args: { 0: p => p.name, 1: '<token>' } })
	public async getPullRequestForBranch(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		branch: string,
		baseUrl: string,
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const response = await this.request<{
			values: BitbucketPullRequest[];
			pagelen: number;
			size: number;
			page: number;
		}>(
			provider,
			token,
			baseUrl,
			`repositories/${owner}/${repo}/pullrequests?q=source.branch.name="${branch}"&fields=%2Bvalues.reviewers,%2Bvalues.participants`,
			{
				method: 'GET',
			},
			scope,
		);

		if (!response?.values?.length) {
			return undefined;
		}
		return fromBitbucketPullRequest(response.values[0], provider);
	}

	@debug<BitbucketApi['getUsersIssuesForRepo']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getUsersIssuesForRepo(
		provider: Provider,
		token: string,
		userUuid: string,
		owner: string,
		repo: string,
		baseUrl: string,
	): Promise<Issue[] | undefined> {
		const scope = getLogScope();
		const query = encodeURIComponent(`assignee.uuid="${userUuid}" OR reporter.uuid="${userUuid}"`);

		const response = await this.request<{
			values: BitbucketIssue[];
			pagelen: number;
			size: number;
			page: number;
		}>(
			provider,
			token,
			baseUrl,
			`repositories/${owner}/${repo}/issues?q=${query}`,
			{
				method: 'GET',
			},
			scope,
		);

		if (!response?.values?.length) {
			return undefined;
		}
		return response.values.map(issue => fromBitbucketIssue(issue, provider));
	}

	@debug<BitbucketApi['getIssue']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getIssue(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		id: string,
		baseUrl: string,
	): Promise<Issue | undefined> {
		const scope = getLogScope();

		try {
			const response = await this.request<BitbucketIssue>(
				provider,
				token,
				baseUrl,
				`repositories/${owner}/${repo}/issues/${id}`,
				{
					method: 'GET',
				},
				scope,
			);

			if (response) {
				return fromBitbucketIssue(response, provider);
			}
			return undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@debug<BitbucketApi['getIssueOrPullRequest']>({ args: { 0: p => p.name, 1: '<token>' } })
	public async getIssueOrPullRequest(
		provider: Provider,
		token: string,
		owner: string,
		repo: string,
		id: string,
		baseUrl: string,
		options?: {
			type?: IssueOrPullRequestType;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();

		if (options?.type !== 'issue') {
			try {
				const prResponse = await this.request<BitbucketPullRequest>(
					provider,
					token,
					baseUrl,
					`repositories/${owner}/${repo}/pullrequests/${id}?fields=%2Bvalues.reviewers,%2Bvalues.participants`,
					{
						method: 'GET',
					},
					scope,
				);

				if (prResponse) {
					return fromBitbucketPullRequest(prResponse, provider);
				}
			} catch (ex) {
				if (ex.original?.status !== 404) {
					Logger.error(ex, scope);
					return undefined;
				}
			}
		}

		if (options?.type !== 'pullrequest') {
			try {
				const issueResponse = await this.request<BitbucketIssue>(
					provider,
					token,
					baseUrl,
					`repositories/${owner}/${repo}/issues/${id}`,
					{
						method: 'GET',
					},
					scope,
				);

				if (issueResponse) {
					return {
						id: issueResponse.id.toString(),
						type: 'issue',
						nodeId: issueResponse.id.toString(),
						provider: provider,
						createdDate: new Date(issueResponse.created_on),
						updatedDate: new Date(issueResponse.updated_on),
						state: bitbucketIssueStateToState(issueResponse.state),
						closed: issueResponse.state === 'closed',
						title: issueResponse.title,
						url: issueResponse.links.html.href,
					};
				}
			} catch (ex) {
				Logger.error(ex, scope);
				return undefined;
			}
		}

		return undefined;
	}

	@debug<BitbucketApi['getRepositoriesForWorkspace']>({ args: { 0: p => p.name, 1: '<token>' } })
	async getRepositoriesForWorkspace(
		provider: Provider,
		token: string,
		workspace: string,
		options: {
			baseUrl: string;
		},
	): Promise<RepositoryMetadata[] | undefined> {
		const scope = getLogScope();

		try {
			interface BitbucketRepositoriesResponse {
				size: number;
				page: number;
				pagelen: number;
				next?: string;
				previous?: string;
				values: BitbucketRepository[];
			}

			const response = await this.request<BitbucketRepositoriesResponse>(
				provider,
				token,
				options.baseUrl,
				`repositories/${workspace}?role=contributor&fields=%2Bvalues.parent.workspace`, // field=+<field> must be encoded as field=%2B<field>
				{
					method: 'GET',
				},
				scope,
			);

			if (response) {
				return response.values.map(repo => {
					return {
						provider: provider,
						owner: repo.workspace.slug,
						name: repo.slug,
						isFork: Boolean(repo.parent),
						parent: repo.parent
							? {
									owner: repo.parent.workspace.slug,
									name: repo.parent.slug,
							  }
							: undefined,
					};
				});
			}
			return undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	async getPullRequestsForWorkspaceAuthoredByUser(
		provider: Provider,
		token: string,
		userUuid: string,
		workspace: string,
		baseUrl: string,
	): Promise<PullRequest[] | undefined> {
		const scope = getLogScope();

		const response = await this.request<{
			values: BitbucketPullRequest[];
			pagelen: number;
			size: number;
			page: number;
		}>(
			provider,
			token,
			baseUrl,
			`workspaces/${workspace}/pullrequests/${userUuid}?state=OPEN&fields=%2Bvalues.reviewers,%2Bvalues.participants`,
			{
				method: 'GET',
			},
			scope,
		);

		if (!response?.values?.length) {
			return undefined;
		}
		return response.values.map(pr => fromBitbucketPullRequest(pr, provider));
	}

	async getUsersReviewingPullRequestsForRepo(
		provider: Provider,
		token: string,
		userUuid: string,
		owner: string,
		repo: string,
		baseUrl: string,
	): Promise<PullRequest[] | undefined> {
		const scope = getLogScope();

		const query = encodeURIComponent(`state="OPEN" AND reviewers.uuid="${userUuid}"`);
		const response = await this.request<{
			values: BitbucketPullRequest[];
			pagelen: number;
			size: number;
			page: number;
		}>(
			provider,
			token,
			baseUrl,
			`repositories/${owner}/${repo}/pullrequests?q=${query}&state=OPEN&fields=%2Bvalues.reviewers,%2Bvalues.participants`,
			{
				method: 'GET',
			},
			scope,
		);

		if (!response?.values?.length) {
			return undefined;
		}
		return response.values.map(pr => fromBitbucketPullRequest(pr, provider));
	}

	private async request<T>(
		provider: Provider,
		token: string,
		baseUrl: string,
		route: string,
		options?: { method: RequestInit['method'] } & Record<string, unknown>,
		scope?: LogScope | undefined,
		cancellation?: CancellationToken | undefined,
	): Promise<T | undefined> {
		const url = `${baseUrl}/${route}`;

		let rsp: Response;
		try {
			const sw = maybeStopWatch(`[BITBUCKET] ${options?.method ?? 'GET'} ${url}`, { log: false });
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

				throw new ProviderFetchError('Bitbucket', rsp);
			} finally {
				sw?.stop();
			}
		} catch (ex) {
			if (ex instanceof ProviderFetchError || ex.name === 'AbortError') {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				void window.showErrorMessage(`Bitbucket request failed: ${ex.message}`);
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
				throw new AuthenticationError('bitbucket', AuthenticationErrorReason.Unauthorized, ex);
			case 403: // Forbidden
				// TODO: Learn the Bitbucket API docs and put it in order:
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
				throw new AuthenticationError('bitbucket', AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				Logger.error(ex, scope);
				if (ex.response != null) {
					provider?.trackRequestException();
					void showIntegrationRequestFailed500WarningMessage(
						`${provider?.name ?? 'Bitbucket'} failed to respond and might be experiencing issues.${
							provider == null || provider.id === 'bitbucket'
								? ' Please visit the [Bitbucket status page](https://bitbucket.status.atlassian.com/) for more information.'
								: ''
						}`,
					);
				}
				return;
			case 502: // Bad Gateway
				Logger.error(ex, scope);
				// TODO: Learn the Bitbucket API docs and put it in order:
				// if (ex.message.includes('timeout')) {
				// 	provider?.trackRequestException();
				// 	void showIntegrationRequestTimedOutWarningMessage(provider?.name ?? 'Bitbucket');
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
				`Bitbucket request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}
}
