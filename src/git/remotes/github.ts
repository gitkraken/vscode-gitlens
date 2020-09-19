'use strict';
import { AuthenticationSession, Range, Uri } from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { Container } from '../../container';
import { IssueOrPullRequest } from '../models/issue';
import { GitRevision } from '../models/models';
import { PullRequest } from '../models/pullRequest';
import { Repository } from '../models/repository';
import { RemoteProviderWithApi } from './provider';

const issueEnricher3rdParyRegex = /\b(\w+\\?-?\w+(?!\\?-)\/\w+\\?-?\w+(?!\\?-))\\?#([0-9]+)\b/g;
const fileRegex = /^\/([^/]+)\/([^/]+?)\/blob(.+)$/i;
const rangeRegex = /^L(\d+)(?:-L(\d+))?$/;

const authProvider = Object.freeze({ id: 'github', scopes: ['repo'] });

export class GitHubRemote extends RemoteProviderWithApi {
	protected get authProvider() {
		return authProvider;
	}

	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	get apiBaseUrl() {
		return this.custom ? `${this.protocol}://${this.domain}/api` : `https://api.${this.domain}`;
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
				{
					prefix: 'gh-',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue #<num> on ${this.name}`,
					ignoreCase: true,
				},
				{
					linkify: (text: string) =>
						text.replace(
							issueEnricher3rdParyRegex,
							`[$&](${this.protocol}://${this.domain}/$1/issues/$2 "Open Issue #$2 from $1 on ${this.name}")`,
						),
				},
			];
		}
		return this._autolinks;
	}

	get icon() {
		return 'github';
	}

	get name() {
		return this.formatName('GitHub');
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
		return `${this.baseUrl}/branches`;
	}

	protected getUrlForBranch(branch: string): string {
		return `${this.baseUrl}/commits/${branch}`;
	}

	protected getUrlForCommit(sha: string): string {
		return `${this.baseUrl}/commit/${sha}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range) {
			if (range.start.line === range.end.line) {
				line = `#L${range.start.line}`;
			} else {
				line = `#L${range.start.line}-L${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.baseUrl}/blob/${sha}/${fileName}${line}`;
		if (branch) return `${this.baseUrl}/blob/${branch}/${fileName}${line}`;
		return `${this.baseUrl}?path=${fileName}${line}`;
	}

	protected async onGetIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.github)?.getIssueOrPullRequest(this.name, accessToken, owner, repo, Number(id), {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async onGetPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.github)?.getPullRequestForCommit(this.name, accessToken, owner, repo, ref, {
			baseUrl: this.apiBaseUrl,
		});
	}
}
