import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks';
import type { RemotesUrlsConfig } from '../../config';
import type { GkProviderId } from '../../gk/models/repositoryIdentities';
import { getTokensFromTemplate, interpolate } from '../../system/string';
import type { Repository } from '../models/repository';
import type { RemoteProviderId } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

export class CustomRemote extends RemoteProvider {
	private readonly urls: RemotesUrlsConfig;

	constructor(domain: string, path: string, urls: RemotesUrlsConfig, protocol?: string, name?: string) {
		super(domain, path, protocol, name, true);
		this.urls = urls;
	}

	get id(): RemoteProviderId {
		return 'custom';
	}

	get gkProviderId(): GkProviderId | undefined {
		return undefined;
	}

	get name() {
		return this.formatName('Custom');
	}

	protected override get issueLinkPattern(): string {
		throw new Error('unsupported');
	}

	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		return [];
	}

	getLocalInfoFromRemoteUri(
		_repository: Repository,
		_uri: Uri,
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined> {
		return Promise.resolve(undefined);
	}

	protected override getUrlForRepository(): string {
		return this.getUrl(this.urls.repository, this.getContext());
	}

	protected getUrlForBranches(): string {
		return this.getUrl(this.urls.branches, this.getContext());
	}

	protected getUrlForBranch(branch: string): string {
		return this.getUrl(this.urls.branch, this.getContext({ branch: branch }));
	}

	protected getUrlForCommit(sha: string): string {
		return this.getUrl(this.urls.commit, this.getContext({ id: sha }));
	}

	protected override getUrlForComparison(base: string, compare: string, notation: '..' | '...'): string | undefined {
		if (this.urls.comparison == null) return undefined;

		return this.getUrl(this.urls.comparison, this.getContext({ ref1: base, ref2: compare, notation: notation }));
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = interpolate(this.urls.fileLine, { line: range.start.line, line_encoded: range.start.line });
			} else {
				line = interpolate(this.urls.fileRange, {
					start: range.start.line,
					start_encoded: range.start.line,
					end: range.end.line,
					end_encoded: range.end.line,
				});
			}
		} else {
			line = '';
		}

		let template;
		let context;
		if (sha) {
			template = this.urls.fileInCommit;
			context = this.getContext({ id: sha, file: fileName, line: line });
		} else if (branch) {
			template = this.urls.fileInBranch;
			context = this.getContext({ branch: branch, file: fileName, line: line });
		} else {
			template = this.urls.file;
			context = this.getContext({ file: fileName, line: line });
		}

		let url = interpolate(template, context);
		const encoded = getTokensFromTemplate(template).some(t => t.key.endsWith('_encoded'));
		if (encoded) return url;

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

	private getUrl(template: string, context: Record<string, string>): string {
		const url = interpolate(template, context);
		const encoded = getTokensFromTemplate(template).some(t => t.key.endsWith('_encoded'));
		return encoded ? url : this.encodeUrl(url);
	}

	private getContext(additionalContext?: Record<string, string>) {
		const [repoBase, repoPath] = this.splitPath();
		const context: Record<string, string> = {
			repo: this.path,
			repoBase: repoBase,
			repoPath: repoPath,
			...additionalContext,
		};

		for (const [key, value] of Object.entries(context)) {
			context[`${key}_encoded`] = encodeURIComponent(value);
		}

		return context;
	}
}
