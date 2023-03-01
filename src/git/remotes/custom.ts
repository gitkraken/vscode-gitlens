import type { Range, Uri } from 'vscode';
import type { RemotesUrlsConfig } from '../../config';
import { interpolate } from '../../system/string';
import type { Repository } from '../models/repository';
import { RemoteProvider } from './remoteProvider';

export class CustomRemote extends RemoteProvider {
	private readonly urls: RemotesUrlsConfig;

	constructor(domain: string, path: string, urls: RemotesUrlsConfig, protocol?: string, name?: string) {
		super(domain, path, protocol, name, true);
		this.urls = urls;
	}

	get id() {
		return 'custom';
	}

	get name() {
		return this.formatName('Custom');
	}

	getLocalInfoFromRemoteUri(
		_repository: Repository,
		_uri: Uri,
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined> {
		return Promise.resolve(undefined);
	}

	protected override getUrlForRepository(): string {
		return this.encodeUrl(interpolate(this.urls.repository, this.getContext()));
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(interpolate(this.urls.branches, this.getContext()));
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(interpolate(this.urls.branch, this.getContext({ branch: branch })));
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(interpolate(this.urls.commit, this.getContext({ id: sha })));
	}

	protected override getUrlForComparison(base: string, compare: string, notation: '..' | '...'): string | undefined {
		if (this.urls.comparison == null) return undefined;

		return this.encodeUrl(
			interpolate(this.urls.comparison, this.getContext({ ref1: base, ref2: compare, notation: notation })),
		);
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = interpolate(this.urls.fileLine, { line: range.start.line });
			} else {
				line = interpolate(this.urls.fileRange, { start: range.start.line, end: range.end.line });
			}
		} else {
			line = '';
		}

		let url;
		if (sha) {
			url = interpolate(this.urls.fileInCommit, this.getContext({ id: sha, file: fileName, line: line }));
		} else if (branch) {
			url = interpolate(this.urls.fileInBranch, this.getContext({ branch: branch, file: fileName, line: line }));
		} else {
			url = interpolate(this.urls.file, this.getContext({ file: fileName, line: line }));
		}

		const decodeHash = url.includes('#');
		url = this.encodeUrl(url);
		if (decodeHash) {
			const index = url.lastIndexOf('%23');
			if (index !== -1) {
				url = `${url.substring(0, index)}#${url.substring(index + 3)}`;
			}
		}
		return url;
	}

	private getContext(context?: Record<string, unknown>) {
		const [repoBase, repoPath] = this.splitPath();
		return {
			repo: this.path,
			repoBase: repoBase,
			repoPath: repoPath,
			...(context ?? {}),
		};
	}
}
