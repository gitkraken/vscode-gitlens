import type { Range, Uri } from 'vscode';
import type { DynamicAutolinkReference } from '../../annotations/autolinks';
import type { AutolinkReference } from '../../config';
import { AutolinkType } from '../../config';
import { isSha } from '../models/reference';
import type { Repository } from '../models/repository';
import { RemoteProvider } from './remoteProvider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
const rangeRegex = /^lines-(\d+)(?::(\d+))?$/;

export class BitbucketServerRemote extends RemoteProvider {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: 'issue #',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue #<num> on ${this.name}`,

					type: AutolinkType.Issue,
					description: `${this.name} Issue #<num>`,
				},
				{
					prefix: 'pull request #',
					ignoreCase: true,
					url: `${this.baseUrl}/pull-requests/<num>`,
					title: `Open Pull Request #<num> on ${this.name}`,

					type: AutolinkType.PullRequest,
					description: `${this.name} Pull Request #<num>`,
				},
			];
		}
		return this._autolinks;
	}

	protected override get baseUrl(): string {
		const [project, repo] = this.path.startsWith('scm/')
			? this.path.replace('scm/', '').split('/')
			: this.splitPath();
		return `${this.protocol}://${this.domain}/projects/${project}/repos/${repo}`;
	}

	override get icon() {
		return 'bitbucket';
	}

	get id() {
		return 'bitbucket-server';
	}

	get name() {
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
				const uri = repository.toAbsoluteUri(path.substr(index), { validate: options?.validate });
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

			possibleBranches.set(branch, path.substr(index));
		} while (index > 0);

		if (possibleBranches.size !== 0) {
			const { values: branches } = await repository.getBranches({
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

	protected override getUrlForComparison(base: string, compare: string, _notation: '..' | '...'): string {
		return this.encodeUrl(`${this.baseUrl}/branches/compare/${base}%0D${compare}`).replace('%250D', '%0D');
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
