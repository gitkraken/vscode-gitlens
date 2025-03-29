import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks/models/autolinks';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import type { GitRevisionRangeNotation } from '../models/revision';
import { isSha } from '../utils/revision.utils';
import type { RemoteProviderId } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
const rangeRegex = /^L(\d+)(?:-L(\d+))?$/;

export class GiteaRemote extends RemoteProvider {
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
					prefix: '#',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: false,
					title: `Open Issue #<num> on ${this.name}`,

					type: 'issue',
					description: `${this.name} Issue #<num>`,
				},
			];
		}
		return this._autolinks;
	}

	override get icon(): string {
		return 'gitea';
	}

	get id(): RemoteProviderId {
		return 'gitea';
	}

	get gkProviderId(): GkProviderId | undefined {
		return undefined; // TODO@eamodio DRAFTS add this when supported by backend
	}

	get name(): string {
		return this.formatName('Gitea');
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
		let offset;
		let index;

		// Check for a permalink
		if (path.startsWith('/commit/')) {
			offset = '/commit/'.length;
			index = path.indexOf('/', offset);
			if (index !== -1) {
				const sha = path.substring(offset, index);
				if (isSha(sha)) {
					const uri = repository.toAbsoluteUri(path.substring(index), { validate: options?.validate });
					if (uri != null) return { uri: uri, startLine: startLine, endLine: endLine };
				}
			}
		}

		// Check for a link with branch (and deal with branch names with /)
		if (path.startsWith('/branch/')) {
			let branch;
			const possibleBranches = new Map<string, string>();
			offset = '/branch/'.length;
			index = offset;
			do {
				branch = path.substring(offset, index);
				possibleBranches.set(branch, path.substring(index));

				index = path.indexOf('/', index + 1);
			} while (index < path.length && index !== -1);

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
		}

		return undefined;
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/src/branch/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, _notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/compare/${base}...${head}`);
	}

	protected override getUrlForCreatePullRequest(
		base: { branch?: string; remote: { path: string; url: string } },
		head: { branch: string; remote: { path: string; url: string } },
		options?: { title?: string; description?: string },
	): string | undefined {
		const query = new URLSearchParams({ head: head.branch, base: base.branch ?? '' });
		if (options?.title) {
			query.set('title', options.title);
		}
		if (options?.description) {
			query.set('body', options.description);
		}
		return `${this.encodeUrl(`${this.baseUrl}/pulls/new`)}?${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#L${range.start.line}`;
			} else {
				line = `#L${range.start.line}-L${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/src/commit/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/src/branch/${branch}/${fileName}`)}${line}`;
		// this route is deprecated but there is no alternative
		return `${this.encodeUrl(`${this.baseUrl}/src/${fileName}`)}${line}`;
	}
}
