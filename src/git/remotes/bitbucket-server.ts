import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks/models/autolinks';
import type { Brand, Unbrand } from '../../system/brand';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import { isSha } from '../utils/revision.utils';
import type { RemoteProviderId } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
const rangeRegex = /^lines-(\d+)(?::(\d+))?$/;

export class BitbucketServerRemote extends RemoteProvider {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	protected override get issueLinkPattern(): string {
		return `${this.baseUrl}/issues/<num>`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				...super.autolinks,
				{
					prefix: 'issue #',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: true,
					title: `Open Issue #<num> on ${this.name}`,

					type: 'issue',
					description: `${this.name} Issue #<num>`,
				},
				{
					prefix: 'pull request #',
					alphanumeric: false,
					ignoreCase: true,
					url: `${this.baseUrl}/pull-requests/<num>`,
					title: `Open Pull Request #<num> on ${this.name}`,

					type: 'pullrequest',
					description: `${this.name} Pull Request #<num>`,
				},
			];
		}
		return this._autolinks;
	}

	protected override get baseUrl(): string {
		const [project, repo] = this.splitPath();
		return `${this.protocol}://${this.domain}/projects/${project}/repos/${repo}`;
	}

	protected override splitPath(): [string, string] {
		if (this.path.startsWith('scm/') && this.path.indexOf('/') !== this.path.lastIndexOf('/')) {
			const path = this.path.replace('scm/', '');
			const index = path.indexOf('/');
			return [path.substring(0, index), path.substring(index + 1)];
		}

		return super.splitPath();
	}

	override get icon(): string {
		return 'bitbucket';
	}

	get id(): RemoteProviderId {
		return 'bitbucket-server';
	}

	get gkProviderId(): GkProviderId {
		return 'bitbucketServer' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return this.formatName('Bitbucket Server');
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
			if (isSha(sha)) {
				const uri = repository.toAbsoluteUri(path.substring(index), { validate: options?.validate });
				if (uri != null) return { uri: uri, startLine: startLine, endLine: endLine };
			}
		}

		// Check for a link with branch (and deal with branch names with /)
		let branch;
		const possibleBranches = new Map<string, string>();
		index = path.length;
		do {
			index = path.lastIndexOf('/', index - 1);
			branch = path.substring(1, index);

			possibleBranches.set(branch, path.substring(index));
		} while (index > 0);

		if (possibleBranches.size !== 0) {
			const { values: branches } = await repository.git.branches().getBranches({
				filter: b => b.remote && possibleBranches.has(b.getNameWithoutRemote()),
			});
			for (const branch of branches) {
				const path = possibleBranches.get(branch.getNameWithoutRemote());
				if (path == null) continue;

				const uri = repository.toAbsoluteUri(path, { validate: options?.validate });
				if (uri != null) return { uri: uri, startLine: startLine, endLine: endLine };
			}
		}

		return undefined;
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/commits?until=${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commits/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, _notation: '..' | '...'): string {
		return this.encodeUrl(`${this.baseUrl}/branches/compare/${base}%0D${head}`).replace('%250D', '%0D');
	}

	protected override getUrlForCreatePullRequest(
		base: { branch?: string; remote: { path: string; url: string } },
		head: { branch: string; remote: { path: string; url: string } },
		options?: { title?: string; description?: string },
	): string | undefined {
		const query = new URLSearchParams({ sourceBranch: head.branch, targetBranch: base.branch ?? '' });
		// TODO: figure this out
		// query.set('targetRepoId', base.repoId);
		if (options?.title) {
			query.set('title', options.title);
		}
		if (options?.description) {
			query.set('description', options.description);
		}

		return `${this.encodeUrl(`${this.baseUrl}/pull-requests?create`)}&${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#${range.start.line}`;
			} else {
				line = `#${range.start.line}-${range.end.line}`;
			}
		} else {
			line = '';
		}
		if (sha) return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}?at=${sha}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}?at=${branch}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}`)}${line}`;
	}
}
