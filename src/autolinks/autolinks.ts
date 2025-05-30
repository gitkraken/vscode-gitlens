import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import { GlyphChars } from '../constants';
import type { IntegrationId } from '../constants.integrations';
import { IssueIntegrationId } from '../constants.integrations';
import type { Container } from '../container';
import type { IssueOrPullRequest } from '../git/models/issue';
import { getIssueOrPullRequestHtmlIcon, getIssueOrPullRequestMarkdownIcon } from '../git/models/issue';
import type { GitRemote } from '../git/models/remote';
import type { ProviderReference } from '../git/models/remoteProvider';
import type { HostingIntegration, IssueIntegration, ResourceDescriptor } from '../plus/integrations/integration';
import { fromNow } from '../system/date';
import { debug } from '../system/decorators/log';
import { encodeUrl } from '../system/encoding';
import { join, map } from '../system/iterable';
import { Logger } from '../system/logger';
import { escapeMarkdown } from '../system/markdown';
import type { MaybePausedResult } from '../system/promise';
import { getSettledValue, isPromise } from '../system/promise';
import { capitalize, encodeHtmlWeak, escapeRegex, getSuperscript } from '../system/string';
import { configuration } from '../system/vscode/configuration';

const emptyAutolinkMap = Object.freeze(new Map<string, Autolink>());

const numRegex = /<num>/g;

export type AutolinkType = 'issue' | 'pullrequest';
export type AutolinkReferenceType = 'commit' | 'branch';

export interface AutolinkReference {
	/** Short prefix to match to generate autolinks for the external resource */
	readonly prefix: string;
	/** URL of the external resource to link to */
	readonly url: string;
	/** Whether alphanumeric characters should be allowed in `<num>` */
	readonly alphanumeric: boolean;
	/** Whether case should be ignored when matching the prefix */
	readonly ignoreCase: boolean;
	readonly title: string | undefined;

	readonly type?: AutolinkType;
	readonly referenceType?: AutolinkReferenceType;
	readonly description?: string;
	readonly descriptor?: ResourceDescriptor;
}

export interface Autolink extends AutolinkReference {
	provider?: ProviderReference;
	id: string;
	index?: number;

	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
				prs?: Set<string>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;
}

export type EnrichedAutolink = [
	issueOrPullRequest: Promise<IssueOrPullRequest | undefined> | undefined,
	autolink: Autolink,
];

export type MaybeEnrichedAutolink = readonly [
	issueOrPullRequest: MaybePausedResult<IssueOrPullRequest | undefined> | undefined,
	autolink: Autolink,
];

export function serializeAutolink(value: Autolink): Autolink {
	const serialized: Autolink = {
		provider: value.provider
			? {
					id: value.provider.id,
					name: value.provider.name,
					domain: value.provider.domain,
					icon: value.provider.icon,
			  }
			: undefined,
		id: value.id,
		index: value.index,
		prefix: value.prefix,
		url: value.url,
		alphanumeric: value.alphanumeric,
		ignoreCase: value.ignoreCase,
		title: value.title,
		type: value.type,
		description: value.description,
		descriptor: value.descriptor,
	};
	return serialized;
}

export interface CacheableAutolinkReference extends AutolinkReference {
	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
				prs?: Set<string>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;

	messageHtmlRegex?: RegExp;
	messageMarkdownRegex?: RegExp;
	messageRegex?: RegExp;
	branchNameRegex?: RegExp;
}

export interface DynamicAutolinkReference {
	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
				prs?: Set<string>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;
	parse: (text: string, autolinks: Map<string, Autolink>) => void;
}

export const supportedAutolinkIntegrations = [IssueIntegrationId.Jira];

function isDynamic(ref: AutolinkReference | DynamicAutolinkReference): ref is DynamicAutolinkReference {
	return !('prefix' in ref) && !('url' in ref);
}

function isCacheable(ref: AutolinkReference | DynamicAutolinkReference): ref is CacheableAutolinkReference {
	return 'prefix' in ref && ref.prefix != null && 'url' in ref && ref.url != null;
}

export type RefSet = [
	ProviderReference | undefined,
	(AutolinkReference | DynamicAutolinkReference)[] | CacheableAutolinkReference[],
];

export class Autolinks implements Disposable {
	protected _disposable: Disposable | undefined;
	private _references: CacheableAutolinkReference[] = [];

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));

		this.onConfigurationChanged();
	}

	dispose() {
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'autolinks')) {
			const autolinks = configuration.get('autolinks');
			// Since VS Code's configuration objects are live we need to copy them to avoid writing back to the configuration
			this._references =
				autolinks
					?.filter(a => a.prefix && a.url)
					?.map(a => ({
						prefix: a.prefix,
						url: a.url,
						alphanumeric: a.alphanumeric ?? false,
						ignoreCase: a.ignoreCase ?? false,
						title: a.title ?? undefined,
					})) ?? [];
		}
	}

	/** Collects connected integration autolink references into @param refsets */
	private async collectIntegrationAutolinks(remote: GitRemote | undefined, refsets: RefSet[]): Promise<void> {
		const integrationPromises: Promise<HostingIntegration | IssueIntegration | undefined>[] =
			supportedAutolinkIntegrations.map(async id => this.container.integrations.get(id));
		if (remote?.provider != null) {
			integrationPromises.push(remote.getIntegration());
		}

		const integrations = new Set<HostingIntegration | IssueIntegration>();
		const promises: Promise<void>[] = [];

		// Filter out disconnected or duplicate integrations
		for (const result of await Promise.allSettled(integrationPromises)) {
			const integration = getSettledValue(result);
			if (integration != null && integration.maybeConnected !== false && !integrations.has(integration)) {
				integrations.add(integration);

				const autoLinkRefs = integration.autolinks();
				if (isPromise(autoLinkRefs)) {
					promises.push(
						autoLinkRefs.then(autoLinks => {
							if (autoLinks.length) {
								refsets.push([integration, autoLinks]);
							}
						}),
					);
				} else if (autoLinkRefs.length) {
					refsets.push([integration, autoLinkRefs]);
				}
			}
		}

		if (promises.length === 0) return;

		await Promise.allSettled(promises);
	}

	/** Collects remote provider autolink references into @param refsets */
	private collectRemoteAutolinks(remote: GitRemote | undefined, refsets: RefSet[]): void {
		if (remote?.provider?.autolinks.length) {
			refsets.push([remote.provider, remote.provider.autolinks]);
		}
	}

	/** Collects custom-configured autolink references into @param refsets */
	private collectCustomAutolinks(remote: GitRemote | undefined, refsets: RefSet[]): void {
		if (this._references.length && remote?.provider == null) {
			refsets.push([undefined, this._references]);
		}
	}

	private async getRefSets(remote?: GitRemote, options?: { excludeCustom?: boolean }) {
		const refsets: RefSet[] = [];

		await this.collectIntegrationAutolinks(remote, refsets);
		this.collectRemoteAutolinks(remote, refsets);
		if (!options?.excludeCustom) {
			this.collectCustomAutolinks(remote, refsets);
		}

		return refsets;
	}

	/** @returns A sorted list of autolinks. the first match is the most relevant */
	async getBranchAutolinks(
		branchName: string,
		remote?: GitRemote,
		options?: { excludeCustom?: boolean },
	): Promise<Map<string, Autolink>> {
		const refsets = await this.getRefSets(remote, options);
		if (refsets.length === 0) return emptyAutolinkMap;

		return getBranchAutolinks(branchName, refsets);
	}

	async getAutolinks(message: string, remote?: GitRemote): Promise<Map<string, Autolink>>;
	async getAutolinks(
		message: string,
		remote: GitRemote,
		// eslint-disable-next-line @typescript-eslint/unified-signatures
		options?: { excludeCustom?: boolean },
	): Promise<Map<string, Autolink>>;
	@debug<Autolinks['getAutolinks']>({
		args: {
			0: '<message>',
			1: false,
		},
	})
	async getAutolinks(
		message: string,
		remote?: GitRemote,
		options?: { excludeCustom?: boolean },
	): Promise<Map<string, Autolink>> {
		const refsets = await this.getRefSets(remote, options);
		if (refsets.length === 0) return emptyAutolinkMap;

		return getAutolinks(message, refsets);
	}

	getAutolinkEnrichableId(autolink: Autolink): string {
		switch (autolink.provider?.id) {
			case IssueIntegrationId.Jira:
				return `${autolink.prefix}${autolink.id}`;
			default:
				return autolink.id;
		}
	}

	async getEnrichedAutolinks(
		message: string,
		remote: GitRemote | undefined,
	): Promise<Map<string, EnrichedAutolink> | undefined>;
	async getEnrichedAutolinks(
		autolinks: Map<string, Autolink>,
		remote: GitRemote | undefined,
	): Promise<Map<string, EnrichedAutolink> | undefined>;
	@debug<Autolinks['getEnrichedAutolinks']>({
		args: {
			0: messageOrAutolinks =>
				typeof messageOrAutolinks === 'string' ? '<message>' : `autolinks=${messageOrAutolinks.size}`,
			1: remote => remote?.remoteKey,
		},
	})
	async getEnrichedAutolinks(
		messageOrAutolinks: string | Map<string, Autolink>,
		remote: GitRemote | undefined,
	): Promise<Map<string, EnrichedAutolink> | undefined> {
		if (typeof messageOrAutolinks === 'string') {
			messageOrAutolinks = await this.getAutolinks(messageOrAutolinks, remote);
		}
		if (messageOrAutolinks.size === 0) return undefined;

		let integration = await remote?.getIntegration();
		if (integration != null) {
			const connected = integration.maybeConnected ?? (await integration.isConnected());
			if (!connected || !(await integration.access())) {
				integration = undefined;
			}
		}

		const enrichedAutolinks = new Map<string, EnrichedAutolink>();
		for (const [id, link] of messageOrAutolinks) {
			let linkIntegration = link.provider
				? await this.container.integrations.get(link.provider.id as IntegrationId)
				: undefined;
			if (linkIntegration != null) {
				const connected = linkIntegration.maybeConnected ?? (await linkIntegration.isConnected());
				if (!connected || !(await linkIntegration.access())) {
					linkIntegration = undefined;
				}
			}
			const issueOrPullRequestPromise =
				remote?.provider != null &&
				integration != null &&
				link.provider?.id === integration.id &&
				link.provider?.domain === integration.domain
					? integration.getIssueOrPullRequest(
							link.descriptor ?? remote.provider.repoDesc,
							link.referenceType === 'branch' ? link.id : id,
					  )
					: link.descriptor != null
					  ? linkIntegration?.getIssueOrPullRequest(link.descriptor, this.getAutolinkEnrichableId(link))
					  : undefined;
			enrichedAutolinks.set(id, [issueOrPullRequestPromise, link]);
		}

		return enrichedAutolinks;
	}

	@debug<Autolinks['linkify']>({
		args: {
			0: '<text>',
			2: remotes => remotes?.length,
			3: issuesAndPullRequests => issuesAndPullRequests?.size,
			4: footnotes => footnotes?.size,
		},
	})
	linkify(
		text: string,
		outputFormat: 'html' | 'markdown' | 'plaintext',
		remotes?: GitRemote[],
		enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
		prs?: Set<string>,
		footnotes?: Map<number, string>,
	): string {
		const includeFootnotesInText = outputFormat === 'plaintext' && footnotes == null;
		if (includeFootnotesInText) {
			footnotes = new Map<number, string>();
		}

		const tokenMapping = new Map<string, string>();

		if (enrichedAutolinks?.size) {
			for (const [, [, link]] of enrichedAutolinks) {
				if (this.ensureAutolinkCached(link)) {
					if (link.tokenize != null) {
						text = link.tokenize(text, outputFormat, tokenMapping, enrichedAutolinks, prs, footnotes);
					}
				}
			}
		} else {
			for (const ref of this._references) {
				if (this.ensureAutolinkCached(ref)) {
					if (ref.tokenize != null) {
						text = ref.tokenize(text, outputFormat, tokenMapping, enrichedAutolinks, prs, footnotes);
					}
				}
			}

			if (remotes != null && remotes.length !== 0) {
				remotes = [...remotes].sort((a, b) => {
					const aConnected = a.maybeIntegrationConnected;
					const bConnected = b.maybeIntegrationConnected;
					return aConnected !== bConnected ? (aConnected ? -1 : bConnected ? 1 : 0) : 0;
				});
				for (const r of remotes) {
					if (r.provider == null) continue;

					for (const ref of r.provider.autolinks) {
						if (this.ensureAutolinkCached(ref)) {
							if (ref.tokenize != null) {
								text = ref.tokenize(
									text,
									outputFormat,
									tokenMapping,
									enrichedAutolinks,
									prs,
									footnotes,
								);
							}
						}
					}
				}
			}
		}

		if (tokenMapping.size !== 0) {
			// eslint-disable-next-line no-control-regex
			text = text.replace(/(\x00\d+\x00)/g, (_, t: string) => tokenMapping.get(t) ?? t);
		}

		if (includeFootnotesInText && footnotes?.size) {
			text += `\n${GlyphChars.Dash.repeat(2)}\n${join(
				map(footnotes, ([i, footnote]) => `${getSuperscript(i)} ${footnote}`),
				'\n',
			)}`;
		}

		return text;
	}

	private ensureAutolinkCached(
		ref: CacheableAutolinkReference | DynamicAutolinkReference | Autolink,
	): ref is CacheableAutolinkReference | DynamicAutolinkReference | Autolink {
		if (isDynamic(ref)) return true;
		if (!ref.prefix || !ref.url) return false;
		if (ref.tokenize !== undefined || ref.tokenize === null) return true;

		try {
			ref.tokenize = (
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
				prs?: Set<string>,
				footnotes?: Map<number, string>,
			) => {
				let footnoteIndex: number;

				switch (outputFormat) {
					case 'markdown':
						ensureCachedRegex(ref, outputFormat);
						return text.replace(
							ref.messageMarkdownRegex,
							(_: string, prefix: string, linkText: string, num: string) => {
								const url = encodeUrl(ref.url.replace(numRegex, num));

								let title = '';
								if (ref.title) {
									title = ` "${ref.title.replace(numRegex, num)}`;

									const issueResult = enrichedAutolinks?.get(num)?.[0];
									if (issueResult?.value != null) {
										if (issueResult.paused) {
											if (footnotes != null && !prs?.has(num)) {
												let name = ref.description?.replace(numRegex, num);
												if (name == null) {
													name = `Custom Autolink ${ref.prefix}${num}`;
												}
												footnoteIndex = footnotes.size + 1;
												footnotes.set(
													footnoteIndex,
													`[${getIssueOrPullRequestMarkdownIcon()} ${name} $(loading~spin)](${url}${title}")`,
												);
											}

											title += `\n${GlyphChars.Dash.repeat(2)}\nLoading...`;
										} else {
											const issue = issueResult.value;
											const issueTitle = escapeMarkdown(issue.title.trim());
											const issueTitleQuoteEscaped = issueTitle.replace(/"/g, '\\"');

											if (footnotes != null && !prs?.has(num)) {
												footnoteIndex = footnotes.size + 1;
												footnotes.set(
													footnoteIndex,
													`[${getIssueOrPullRequestMarkdownIcon(
														issue,
													)} **${issueTitle}**](${url}${title}")\\\n${GlyphChars.Space.repeat(
														5,
													)}${linkText} ${issue.state} ${fromNow(
														issue.closedDate ?? issue.createdDate,
													)}`,
												);
											}

											title += `\n${GlyphChars.Dash.repeat(
												2,
											)}\n${issueTitleQuoteEscaped}\n${capitalize(issue.state)}, ${fromNow(
												issue.closedDate ?? issue.createdDate,
											)}`;
										}
									} else if (footnotes != null && !prs?.has(num)) {
										let name = ref.description?.replace(numRegex, num);
										if (name == null) {
											name = `Custom Autolink ${ref.prefix}${num}`;
										}
										footnoteIndex = footnotes.size + 1;
										footnotes.set(
											footnoteIndex,
											`[${getIssueOrPullRequestMarkdownIcon()} ${name}](${url}${title}")`,
										);
									}
									title += '"';
								}

								const token = `\x00${tokenMapping.size}\x00`;
								tokenMapping.set(token, `[${linkText}](${url}${title})`);
								return `${prefix}${token}`;
							},
						);

					case 'html':
						ensureCachedRegex(ref, outputFormat);
						return text.replace(
							ref.messageHtmlRegex,
							(_: string, prefix: string, linkText: string, num: string) => {
								const url = encodeUrl(ref.url.replace(numRegex, num));

								let title = '';
								if (ref.title) {
									title = `"${encodeHtmlWeak(ref.title.replace(numRegex, num))}`;

									const issueResult = enrichedAutolinks?.get(num)?.[0];
									if (issueResult?.value != null) {
										if (issueResult.paused) {
											if (footnotes != null && !prs?.has(num)) {
												let name = ref.description?.replace(numRegex, num);
												if (name == null) {
													name = `Custom Autolink ${ref.prefix}${num}`;
												}
												footnoteIndex = footnotes.size + 1;
												footnotes.set(
													footnoteIndex,
													`<a href="${url}" title=${title}>${getIssueOrPullRequestHtmlIcon()} ${name}</a>`,
												);
											}

											title += `\n${GlyphChars.Dash.repeat(2)}\nLoading...`;
										} else {
											const issue = issueResult.value;
											const issueTitle = encodeHtmlWeak(issue.title.trim());
											const issueTitleQuoteEscaped = issueTitle.replace(/"/g, '&quot;');

											if (footnotes != null && !prs?.has(num)) {
												footnoteIndex = footnotes.size + 1;
												footnotes.set(
													footnoteIndex,
													`<a href="${url}" title=${title}>${getIssueOrPullRequestHtmlIcon(
														issue,
													)} <b>${issueTitle}</b></a><br /><span>${GlyphChars.Space.repeat(
														5,
													)}${linkText} ${issue.state} ${fromNow(
														issue.closedDate ?? issue.createdDate,
													)}</span>`,
												);
											}

											title += `\n${GlyphChars.Dash.repeat(
												2,
											)}\n${issueTitleQuoteEscaped}\n${capitalize(issue.state)}, ${fromNow(
												issue.closedDate ?? issue.createdDate,
											)}`;
										}
									} else if (footnotes != null && !prs?.has(num)) {
										let name = ref.description?.replace(numRegex, num);
										if (name == null) {
											name = `Custom Autolink ${ref.prefix}${num}`;
										}
										footnoteIndex = footnotes.size + 1;
										footnotes.set(
											footnoteIndex,
											`<a href="${url}" title=${title}>${getIssueOrPullRequestHtmlIcon()} ${name}</a>`,
										);
									}
									title += '"';
								}

								const token = `\x00${tokenMapping.size}\x00`;
								tokenMapping.set(token, `<a href="${url}" title=${title}>${linkText}</a>`);
								return `${prefix}${token}`;
							},
						);

					default:
						ensureCachedRegex(ref, outputFormat);
						return text.replace(
							ref.messageRegex,
							(_: string, prefix: string, linkText: string, num: string) => {
								const issueResult = enrichedAutolinks?.get(num)?.[0];
								if (issueResult?.value == null) return linkText;

								if (footnotes != null && !prs?.has(num)) {
									footnoteIndex = footnotes.size + 1;
									footnotes.set(
										footnoteIndex,
										`${linkText}: ${
											issueResult.paused
												? 'Loading...'
												: `${issueResult.value.title}  ${GlyphChars.Dot}  ${capitalize(
														issueResult.value.state,
												  )}, ${fromNow(
														issueResult.value.closedDate ?? issueResult.value.createdDate,
												  )}`
										}`,
									);
								}

								const token = `\x00${tokenMapping.size}\x00`;
								tokenMapping.set(token, `${linkText}${getSuperscript(footnoteIndex)}`);
								return `${prefix}${token}`;
							},
						);
				}
			};
		} catch (ex) {
			Logger.error(
				ex,
				`Failed to create autolink generator: prefix=${ref.prefix}, url=${ref.url}, title=${ref.title}`,
			);
			ref.tokenize = null;
		}

		return true;
	}
}

function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'html',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageHtmlRegex'>;
function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'markdown',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageMarkdownRegex'>;
function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'plaintext',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageRegex' | 'branchNameRegex'>;
function ensureCachedRegex(ref: CacheableAutolinkReference, outputFormat: 'html' | 'markdown' | 'plaintext') {
	// Regexes matches the ref prefix followed by a token (e.g. #1234)
	if (outputFormat === 'markdown' && ref.messageMarkdownRegex == null) {
		// Extra `\\\\` in `\\\\\\[` is because the markdown is escaped
		ref.messageMarkdownRegex = new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(escapeMarkdown(ref.prefix)))}(${
				ref.alphanumeric ? '\\w' : '\\d'
			}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
	} else if (outputFormat === 'html' && ref.messageHtmlRegex == null) {
		ref.messageHtmlRegex = new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(ref.prefix))}(${ref.alphanumeric ? '\\w' : '\\d'}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
	} else if (ref.messageRegex == null) {
		ref.messageRegex = new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(ref.prefix)}(${ref.alphanumeric ? '\\w' : '\\d'}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
		ref.branchNameRegex = new RegExp(
			`(^|\\-|_|\\.|\\/)(?<prefix>${ref.prefix})(?<issueKeyNumber>${
				ref.alphanumeric ? '\\w' : '\\d'
			}+)(?=$|\\-|_|\\.|\\/)`,
			'gi',
		);
	}

	return true;
}

/**
 * Compares autolinks
 * @returns non-0 result that means a probability of the autolink `b` is more relevant of the autolink `a`
 */
function compareAutolinks(a: Autolink, b: Autolink): number {
	// consider that if the number is in the start, it's the most relevant link
	if (b.index === 0) return 1;
	if (a.index === 0) return -1;

	// maybe it worths to use some weight function instead.
	return (
		b.prefix.length - a.prefix.length ||
		b.id.length - a.id.length ||
		(b.index != null && a.index != null ? -(b.index - a.index) : 0)
	);
}

export function getAutolinks(message: string, refsets: Readonly<RefSet[]>) {
	const autolinks = new Map<string, Autolink>();

	let match;
	let num;
	for (const [provider, refs] of refsets) {
		for (const ref of refs) {
			if (!isCacheable(ref) || (ref.referenceType && ref.referenceType !== 'commit')) {
				if (isDynamic(ref)) {
					ref.parse(message, autolinks);
				}
				continue;
			}

			ensureCachedRegex(ref, 'plaintext');

			do {
				match = ref.messageRegex.exec(message);
				if (!match) break;

				[, , , num] = match;

				autolinks.set(num, {
					provider: provider,
					id: num,
					index: match.index,
					prefix: ref.prefix,
					url: ref.url?.replace(numRegex, num),
					alphanumeric: ref.alphanumeric,
					ignoreCase: ref.ignoreCase,
					title: ref.title?.replace(numRegex, num),
					type: ref.type,
					description: ref.description?.replace(numRegex, num),
					descriptor: ref.descriptor,
				});
			} while (true);
		}
	}

	return autolinks;
}

export function getBranchAutolinks(branchName: string, refsets: Readonly<RefSet[]>) {
	const autolinks = new Map<string, Autolink>();

	let match;
	let num;
	for (const [provider, refs] of refsets) {
		for (const ref of refs) {
			if (
				!isCacheable(ref) ||
				ref.type === 'pullrequest' ||
				(ref.referenceType && ref.referenceType !== 'branch')
			) {
				continue;
			}

			ensureCachedRegex(ref, 'plaintext');
			const matches = branchName.matchAll(ref.branchNameRegex);
			do {
				match = matches.next();
				if (!match.value?.groups) break;

				num = match?.value?.groups.issueKeyNumber;
				let index = match.value.index;
				const linkUrl = ref.url?.replace(numRegex, num);
				// strange case (I would say synthetic), but if we parse the link twice, use the most relevant of them
				const existingIndex = autolinks.get(linkUrl)?.index;
				if (existingIndex != null) {
					index = Math.min(index, existingIndex);
				}
				autolinks.set(linkUrl, {
					...ref,
					provider: provider,
					id: num,
					index: index,
					url: linkUrl,
					title: ref.title?.replace(numRegex, num),
					description: ref.description?.replace(numRegex, num),
					descriptor: ref.descriptor,
				});
			} while (!match.done);
		}
	}

	return new Map([...autolinks.entries()].sort((a, b) => compareAutolinks(a[1], b[1])));
}
