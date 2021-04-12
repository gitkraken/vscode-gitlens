'use strict';
import https, { Agent } from 'https';
import fetch from 'node-fetch';
import { CustomRemoteType } from '../config';
import { configuration } from '../configuration';
import { AuthenticationError, ClientError, RichRemoteProvider } from '../git/git';
import { Account } from '../git/models/author';
import { DefaultBranch, IssueOrPullRequest, PullRequest } from '../git/models/models';
import { Logger } from '../logger';
import { debug } from '../system';
import { GitLabAuthService, gitLabAuthService } from './auth-service';
import { GitLabUser } from './author';
import { GitLabCommit } from './commit';
import { GitLabIssue } from './issue';
import { GitLabMergeRequest, GitLabMergeRequestState } from './merge-request';
import { GitLabProject } from './project';

export class GitLabApi {
	private _agent: Agent = https.globalAgent;

	constructor() {
		const config = configuration.get('remotes')?.find(remote => remote.type === CustomRemoteType.GitLab);
		if (config?.ignoreCertErrors) {
			this._agent = new Agent({ ...https.globalAgent.options, rejectUnauthorized: !config.ignoreCertErrors });
		}
	}
	get authService(): GitLabAuthService {
		return gitLabAuthService;
	}

	private _project: GitLabProject | undefined;

	@debug({
		args: {
			3: _ => '<token>',
		},
	})
	async getProjectByPath(
		group: string,
		repo: string,
		baseUrl?: string,
		token?: string,
	): Promise<GitLabProject | undefined> {
		const cc = Logger.getCorrelationContext();

		if (this._project === undefined) {
			try {
				Logger.log(cc, `Getting Project By Path ${baseUrl}/v4/projects?search=${group}/${repo}, ${token}`);
				this._project = (await fetch(`${baseUrl}/v4/projects/${encodeURIComponent(`${group}/${repo}`)}`, {
					headers: { authorization: `Bearer ${token}` },
					agent: this._agent,
				}).then(response => response.json())) as GitLabProject;

				Logger.log(cc, `Project retrieved ${this._project?.id}`);
			} catch (ex) {
				Logger.error(ex, cc);

				if (ex.code >= 400 && ex.code <= 500) {
					if (ex.code === 401) throw new AuthenticationError(ex);
					throw new ClientError(ex);
				}
				throw ex;
			}
		}
		return this._project;
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getAccountForCommit(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			const projectId = await this.getProjectByPath(owner, repo, options?.baseUrl, token).then(
				project => project?.id,
			);
			const commit = (await fetch(`${options?.baseUrl}/v4/projects/${projectId}/repository/commits/${ref}`, {
				headers: { authorization: `Bearer ${token}` },
				agent: this._agent,
				...options,
			}).then(response => response.json())) as GitLabCommit;

			Logger.log(cc, `Commit retrieved, Getting author ${commit.author_name}`);

			const commitAuthor = await this.getUserByAuthorName(commit.author_name, token, options);

			if (commitAuthor == null) return undefined;

			return {
				provider: provider,
				name: commitAuthor.name ?? undefined,
				email: commit.author_email ?? undefined,
				avatarUrl: commitAuthor.avatar_url ?? undefined,
			};
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex.code >= 400 && ex.code <= 500) {
				if (ex.code === 401) throw new AuthenticationError(ex);
				throw new ClientError(ex);
			}
			throw ex;
		}
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getAccountForEmail(
		_provider: RichRemoteProvider,
		_token: string,
		_owner: string,
		_repo: string,
		_email: string,
		_options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			Logger.warn(cc, 'Get Account by email is not supported by the GitLab API at this time.');
			return Promise.resolve(undefined);
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex.code >= 400 && ex.code <= 500) {
				if (ex.code === 401) throw new AuthenticationError(ex);
				throw new ClientError(ex);
			}
			throw ex;
		}
	}

	@debug({
		args: {
			0: (p: RichRemoteProvider) => p.name,
			1: _ => '<token>',
		},
	})
	async getDefaultBranch(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		options?: {
			baseUrl?: string;
		},
	): Promise<DefaultBranch | undefined> {
		const cc = Logger.getCorrelationContext();
		try {
			const defaultBranch = await this.getProjectByPath(owner, repo, options?.baseUrl, token).then(
				project => project?.default_branch,
			);

			if (defaultBranch === undefined) return undefined;

			return {
				provider: provider,
				name: defaultBranch,
			};
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex.code >= 400 && ex.code <= 500) {
				if (ex.code === 401) throw new AuthenticationError(ex);
				throw new ClientError(ex);
			}
			throw ex;
		}
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getIssueOrPullRequest(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		number: number,
		options?: {
			baseUrl?: string;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const cc = Logger.getCorrelationContext();
		const projectId = await this.getProjectByPath(owner, repo, options?.baseUrl, token).then(
			project => project?.id,
		);
		if (projectId) {
			try {
				let issueOrMR: IssueOrPullRequest | undefined = await this.getIssueByNumber(
					number,
					provider,
					token,
					options,
				);
				if (issueOrMR == null) {
					const mr = (await fetch(`${options?.baseUrl}/v4/projects/${projectId}/merge_requests/${number}`, {
						headers: { authorization: `Bearer ${token}` },
						agent: this._agent,
						...options,
					}).then(response => response.json())) as GitLabMergeRequest;

					issueOrMR = {
						type: 'PullRequest',
						closed: mr.closed_at != null,
						date: new Date(mr.created_at),
						id: mr.id,
						provider: provider,
						title: mr.title,
						closedDate: mr.closed_at == null ? undefined : new Date(mr.closed_at),
					};
				}

				return issueOrMR;
			} catch (ex) {
				Logger.error(ex, cc);

				if (ex.code >= 400 && ex.code <= 500) {
					if (ex.code === 401) throw new AuthenticationError(ex);
					throw new ClientError(ex);
				}
				throw ex;
			}
		}
		return undefined;
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getPullRequestForBranch(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		branch: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
			include?: GitLabMergeRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const cc = Logger.getCorrelationContext();

		const projectId = await this.getProjectByPath(owner, repo, options?.baseUrl, token).then(
			project => project?.id,
		);
		if (projectId) {
			try {
				const response = await fetch(
					`${options?.baseUrl}/v4/projects/${projectId}/merge_requests?source_branch=${branch}`,
					{
						headers: { authorization: `Bearer ${token}` },
						agent: this._agent,
						...options,
					},
				);
				const mrs = (await response.json()) as GitLabMergeRequest[];
				if (mrs == null || mrs.length === 0) return undefined;

				if (mrs.length > 1) {
					mrs.sort(
						(a, b) =>
							(a.state === GitLabMergeRequestState.OPEN ? -1 : 1) -
								(b.state === GitLabMergeRequestState.OPEN ? -1 : 1) ||
							new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
					);
				}

				return GitLabMergeRequest.from(mrs[0], provider);
			} catch (ex) {
				Logger.error(ex, cc);

				if (ex.code >= 400 && ex.code <= 500) {
					if (ex.code === 401) throw new AuthenticationError(ex);
					throw new ClientError(ex);
				}
				throw ex;
			}
		}
		return undefined;
	}

	@debug({
		args: {
			1: _ => '<token>',
		},
	})
	async getPullRequestForCommit(
		provider: RichRemoteProvider,
		token: string,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<PullRequest | undefined> {
		const cc = Logger.getCorrelationContext();
		const projectId = await this.getProjectByPath(owner, repo, options?.baseUrl, token).then(
			project => project?.id,
		);
		if (projectId) {
			try {
				const mrs = (await fetch(
					`${options?.baseUrl}/v4/projects/${projectId}/repository/commits/${ref}/merge_requests`,
					{
						headers: { authorization: `Bearer ${token}` },
						agent: this._agent,
						...options,
					},
				).then(response => response.json())) as GitLabMergeRequest[];

				if (mrs == null || mrs.length === 0) return undefined;
				if (mrs.length > 1) {
					mrs.sort(
						(a, b) =>
							(a.state === GitLabMergeRequestState.OPEN ? -1 : 1) -
								(b.state === GitLabMergeRequestState.OPEN ? -1 : 1) ||
							new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
					);
				}

				return GitLabMergeRequest.from(mrs[0], provider);
			} catch (ex) {
				Logger.error(ex, cc);

				if (ex.code >= 400 && ex.code <= 500) {
					if (ex.code === 401) throw new AuthenticationError(ex);
					throw new ClientError(ex);
				}
				throw ex;
			}
		}
		return undefined;
	}

	@debug()
	private async getIssueByNumber(
		number: number,
		provider: RichRemoteProvider,
		token: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			const issue = (await fetch(`${options?.baseUrl}/v4/issues/${number}`, {
				method: 'GET',
				headers: { authorization: `Bearer ${token}` },
				agent: this._agent,
				...options,
			}).then(response => response.json())) as GitLabIssue;

			if (issue == null) {
				return Promise.resolve(undefined);
			}
			return GitLabIssue.from(issue, provider);
		} catch (ex) {
			Logger.error(ex, cc);

			if (ex.code >= 400 && ex.code <= 500) {
				if (ex.code === 401) throw new AuthenticationError(ex);
				throw new ClientError(ex);
			}
			throw ex;
		}
	}

	@debug()
	private async getUserByAuthorName(
		authorName: string,
		token: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<GitLabUser> {
		const users = (await fetch(`${options?.baseUrl}/v4/users?search=${authorName}`, {
			headers: { authorization: `Bearer ${token}` },
			agent: this._agent,
			...options,
		}).then(resp => resp.json())) as GitLabUser[];

		if (users.length > 1) {
			users.sort(
				(a: GitLabUser, b: GitLabUser) => (a.state === 'active' ? -1 : 1) - (b.state === 'active' ? -1 : 1),
			);
		}
		return users[0];
	}
}
