import { getTokensFromTemplate, interpolate } from '@gitlens/utils/string.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type { RemoteProviderId, RemotesUrlsConfig } from '../models/remoteProvider.js';
import { RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';

export class CustomRemoteProvider extends RemoteProvider {
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

	get name(): string {
		return this.formatName('Custom');
	}

	protected override get issueLinkPattern(): string {
		throw new Error('unsupported');
	}

	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		return [];
	}

	getUrlForAvatar(email: string, size: number): string | undefined {
		if (this.urls.avatar == null) return undefined;

		// Split on the last `@` so local-parts that contain `@` are preserved (per RFC 5322)
		const at = email.lastIndexOf('@');
		const emailName = at === -1 ? email : email.slice(0, at);
		const domain = at === -1 ? '' : email.slice(at + 1);

		// Component-encode identity values — commit emails are attacker-controllable and
		// must never be able to inject URL-structural characters (`/`, `?`, `#`, ...) into the
		// resulting URL
		return interpolate(this.urls.avatar, {
			email: encodeURIComponent(email),
			emailName: encodeURIComponent(emailName),
			domain: encodeURIComponent(domain),
			size: String(size),
		});
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

	protected override getUrlForComparison(
		base: string,
		head: string,
		notation: GitRevisionRangeNotation,
	): string | undefined {
		if (this.urls.comparison == null) return undefined;

		return this.getUrl(this.urls.comparison, this.getContext({ ref1: base, ref2: head, notation: notation }));
	}

	protected override getUrlForCreatePullRequest({ base, head }: CreatePullRequestRemoteResource): string | undefined {
		if (this.urls.createPullRequest == null) return undefined;

		return this.getUrl(
			this.urls.createPullRequest,
			this.getContext({ base: base.branch ?? '', head: head.branch }),
		);
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string {
		let line;
		if (range != null) {
			if (range.startLine === range.endLine) {
				line = interpolate(this.urls.fileLine, { line: range.startLine, line_encoded: range.startLine });
			} else {
				line = interpolate(this.urls.fileRange, {
					start: range.startLine,
					start_encoded: range.startLine,
					end: range.endLine,
					end_encoded: range.endLine,
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
		const [repoBase, repoPath] = this.splitPath(this.path);
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
