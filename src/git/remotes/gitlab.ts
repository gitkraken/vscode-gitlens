'use strict';
import { AuthenticationSession, Range, Uri } from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { Container } from '../../container';
import { GitLabMergeRequest } from '../../gitlab/merge-request';
import {
	Account,
	DefaultBranch,
	GitRevision,
	IssueOrPullRequest,
	PullRequest,
	PullRequestState,
} from '../models/models';
import { Repository } from '../models/repository';
import { RichRemoteProvider } from './provider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/-\/blob(.+)$/i;
const rangeRegex = /^L(\d+)(?:-(\d+))?$/;

const authProvider = Object.freeze({ id: 'gitlab', scopes: ['repo'] });

export class GitLabRemote extends RichRemoteProvider {
	protected get authProvider() {
		return authProvider;
	}

	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	get apiBaseUrl() {
		return this.custom ? `${this.protocol}://${this.domain}/api` : `https://${this.domain}/api`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: '#',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue #<num> on ${this.name}`,
				},
			];
		}
		return this._autolinks;
	}

	get icon() {
		return 'gitlab';
	}

	get id() {
		return 'gitlab';
	}

	get name() {
		return this.formatName('GitLab');
	}

	async getLocalInfoFromRemoteUri(
		repository: Repository,
		uri: Uri,
		options?: { validate?: boolean },
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined> {
		if (uri.authority !== this.domain) return undefined;
		if ((options?.validate ?? true) && !uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		let endLine;
		if (uri.fragment) {
			const match = rangeRegex.exec(uri.fragment);
			if (match != null) {
				const [, start, end] = match;
				if (start) {
					startLine = parseInt(start, 10);
					if (end) {
						endLine = parseInt(end, 10);
					}
				}
			}
		}

		const match = fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , , path] = match;

		// Check for a permalink
		let index = path.indexOf('/', 1);
		if (index !== -1) {
			const sha = path.substring(1, index);
			if (GitRevision.isSha(sha)) {
				const uri = repository.toAbsoluteUri(path.substr(index), { validate: options?.validate });
				if (uri != null) return { uri: uri, startLine: startLine, endLine: endLine };
			}
		}

		const branches = new Set<string>(
			(
				await repository.getBranches({
					filter: b => b.remote,
				})
			).map(b => b.getNameWithoutRemote()),
		);

		// Check for a link with branch (and deal with branch names with /)
		let branch;
		index = path.length;
		do {
			index = path.lastIndexOf('/', index - 1);
			branch = path.substring(1, index);

			if (branches.has(branch)) {
				const uri = repository.toAbsoluteUri(path.substr(index), { validate: options?.validate });
				if (uri != null) return { uri: uri, startLine: startLine, endLine: endLine };
			}
		} while (index > 0);

		return undefined;
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/tree/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commit/${sha}`);
	}

	protected getUrlForComparison(base: string, compare: string, notation: '..' | '...'): string {
		return this.encodeUrl(`${this.baseUrl}/-/compare/${base}${notation}${compare}`);
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#L${range.start.line}`;
			} else {
				line = `#L${range.start.line}-${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/blob/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/blob/${branch}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}?path=${fileName}`)}${line}`;
	}

	protected async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.gitlab)?.getAccountForCommit(this, accessToken, owner, repo, ref, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderAccountForEmail(
		{ accessToken }: AuthenticationSession,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.gitlab)?.getAccountForEmail(this, accessToken, owner, repo, email, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderDefaultBranch({
		accessToken,
	}: AuthenticationSession): Promise<DefaultBranch | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.gitlab)?.getDefaultBranch(this, accessToken, owner, repo, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.gitlab)?.getIssueOrPullRequest(this, accessToken, owner, repo, Number(id), {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		const { include, ...opts } = options ?? {};

		return (await Container.gitlab)?.getPullRequestForBranch(this, accessToken, owner, repo, branch, {
			...opts,
			include: include?.map(s => GitLabMergeRequest.toState(s)),
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.gitlab)?.getPullRequestForCommit(this, accessToken, owner, repo, ref, {
			baseUrl: this.apiBaseUrl,
		});
	}
}
