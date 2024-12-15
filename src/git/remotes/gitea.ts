import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks';
import type { GkProviderId } from '../../gk/models/repositoryIdentities';
import type { Repository } from '../models/repository';
import { isSha } from '../models/revision.utils';
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

	override get icon() {
		return 'gitea';
	}

	get id(): RemoteProviderId {
		return 'gitea';
	}

	get gkProviderId(): GkProviderId | undefined {
		return undefined; // TODO@eamodio DRAFTS add this when supported by backend
	}

	get name() {
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
				const { values: branches } = await repository.git.getBranches({
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

	protected override getUrlForComparison(ref1: string, ref2: string, _notation: '..' | '...'): string {
		return this.encodeUrl(`${this.baseUrl}/compare/${ref1}...${ref2}`);
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
