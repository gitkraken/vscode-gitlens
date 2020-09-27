'use strict';
import { Range, Uri } from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { GitRevision } from '../models/models';
import { Repository } from '../models/repository';
import { RemoteProvider } from './provider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
const rangeRegex = /^lines-(\d+)(?::(\d+))?$/;

export class BitbucketRemote extends RemoteProvider {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: 'issue #',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue #<num> on ${this.name}`,
				},
				{
					prefix: 'pull request #',
					url: `${this.baseUrl}/pull-requests/<num>`,
					title: `Open PR #<num> on ${this.name}`,
				},
			];
		}
		return this._autolinks;
	}

	get icon() {
		return 'bitbucket';
	}

	get name() {
		return this.formatName('Bitbucket');
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
		return `${this.baseUrl}/commits/branch/${branch}`;
	}

	protected getUrlForCommit(sha: string): string {
		return `${this.baseUrl}/commits/${sha}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#${fileName}-${range.start.line}`;
			} else {
				line = `#${fileName}-${range.start.line}:${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.baseUrl}/src/${sha}/${fileName}${line}`;
		if (branch) return `${this.baseUrl}/src/${branch}/${fileName}${line}`;
		return `${this.baseUrl}?path=${fileName}${line}`;
	}
}
