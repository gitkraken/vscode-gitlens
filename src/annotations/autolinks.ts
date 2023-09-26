import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import type { AutolinkReference, AutolinkType } from '../config';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import type { IssueOrPullRequest } from '../git/models/issue';
import { getIssueOrPullRequestHtmlIcon, getIssueOrPullRequestMarkdownIcon } from '../git/models/issue';
import type { GitRemote } from '../git/models/remote';
import type { RemoteProviderReference } from '../git/models/remoteProvider';
import type { RichRemoteProvider } from '../git/remotes/richRemoteProvider';
import type { MaybePausedResult } from '../system/cancellation';
import { configuration } from '../system/configuration';
import { fromNow } from '../system/date';
import { debug } from '../system/decorators/log';
import { encodeUrl } from '../system/encoding';
import { join, map } from '../system/iterable';
import { Logger } from '../system/logger';
import { capitalize, encodeHtmlWeak, escapeMarkdown, escapeRegex, getSuperscript } from '../system/string';

const emptyAutolinkMap = Object.freeze(new Map<string, Autolink>());

const numRegex = /<num>/g;

export interface Autolink {
	provider?: RemoteProviderReference;
	id: string;
	prefix: string;
	title?: string;
	url: string;

	type?: AutolinkType;
	description?: string;
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
		prefix: value.prefix,
		title: value.title,
		url: value.url,
		type: value.type,
		description: value.description,
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

function isDynamic(ref: AutolinkReference | DynamicAutolinkReference): ref is DynamicAutolinkReference {
	return !('prefix' in ref) && !('url' in ref);
}

function isCacheable(ref: AutolinkReference | DynamicAutolinkReference): ref is CacheableAutolinkReference {
	return 'prefix' in ref && ref.prefix != null && 'url' in ref && ref.url != null;
}

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
					/**
					 * Only allow properties defined by {@link AutolinkReference}
					 */
					?.map(a => ({
						prefix: a.prefix,
						url: a.url,
						title: a.title,
						alphanumeric: a.alphanumeric,
						ignoreCase: a.ignoreCase,
						type: a.type,
						description: a.description,
					})) ?? [];
		}
	}

	getAutolinks(message: string, remote?: GitRemote): Map<string, Autolink>;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getAutolinks(message: string, remote: GitRemote, options?: { excludeCustom?: boolean }): Map<string, Autolink>;
	@debug<Autolinks['getAutolinks']>({
		args: {
			0: '<message>',
			1: false,
		},
	})
	getAutolinks(message: string, remote?: GitRemote, options?: { excludeCustom?: boolean }): Map<string, Autolink> {
		const refsets: [
			RemoteProviderReference | undefined,
			(AutolinkReference | DynamicAutolinkReference)[] | CacheableAutolinkReference[],
		][] = [];
		if (remote?.provider?.autolinks?.length) {
			refsets.push([remote.provider, remote.provider.autolinks]);
		}
		if (this._references.length && (remote?.provider == null || !options?.excludeCustom)) {
			refsets.push([undefined, this._references]);
		}
		if (refsets.length === 0) return emptyAutolinkMap;

		const autolinks = new Map<string, Autolink>();

		let match;
		let num;
		for (const [provider, refs] of refsets) {
			for (const ref of refs) {
				if (!isCacheable(ref)) {
					if (isDynamic(ref)) {
						ref.parse(message, autolinks);
					}
					continue;
				}

				ensureCachedRegex(ref, 'plaintext');

				do {
					match = ref.messageRegex.exec(message);
					if (match == null) break;

					[, , , num] = match;

					autolinks.set(num, {
						provider: provider,
						id: num,
						prefix: ref.prefix,
						url: ref.url?.replace(numRegex, num),
						title: ref.title?.replace(numRegex, num),

						type: ref.type,
						description: ref.description?.replace(numRegex, num),
					});
				} while (true);
			}
		}

		return autolinks;
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
			messageOrAutolinks = this.getAutolinks(messageOrAutolinks, remote);
		}
		if (messageOrAutolinks.size === 0) return undefined;

		let provider: RichRemoteProvider | undefined;
		if (remote?.hasRichIntegration()) {
			({ provider } = remote);
			const connected = remote.provider.maybeConnected ?? (await remote.provider.isConnected());
			if (!connected) {
				provider = undefined;
			}
		}

		return new Map(
			map(
				messageOrAutolinks,
				([id, link]) =>
					[
						id,
						[
							provider != null &&
							link.provider?.id === provider.id &&
							link.provider?.domain === provider.domain
								? provider.getIssueOrPullRequest(id)
								: undefined,
							link,
						] satisfies EnrichedAutolink,
					] as const,
			),
		);
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

		for (const ref of this._references) {
			if (this.ensureAutolinkCached(ref)) {
				if (ref.tokenize != null) {
					text = ref.tokenize(text, outputFormat, tokenMapping, enrichedAutolinks, prs, footnotes);
				}
			}
		}

		if (remotes != null && remotes.length !== 0) {
			remotes = [...remotes].sort((a, b) => {
				const aConnected = a.provider?.maybeConnected;
				const bConnected = b.provider?.maybeConnected;
				return aConnected !== bConnected ? (aConnected ? -1 : bConnected ? 1 : 0) : 0;
			});
			for (const r of remotes) {
				if (r.provider == null) continue;

				for (const ref of r.provider.autolinks) {
					if (this.ensureAutolinkCached(ref)) {
						if (ref.tokenize != null) {
							text = ref.tokenize(text, outputFormat, tokenMapping, enrichedAutolinks, prs, footnotes);
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
		ref: CacheableAutolinkReference | DynamicAutolinkReference,
	): ref is CacheableAutolinkReference | DynamicAutolinkReference {
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
														issue.closedDate ?? issue.date,
													)}`,
												);
											}

											title += `\n${GlyphChars.Dash.repeat(
												2,
											)}\n${issueTitleQuoteEscaped}\n${capitalize(issue.state)}, ${fromNow(
												issue.closedDate ?? issue.date,
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
														issue.closedDate ?? issue.date,
													)}</span>`,
												);
											}

											title += `\n${GlyphChars.Dash.repeat(
												2,
											)}\n${issueTitleQuoteEscaped}\n${capitalize(issue.state)}, ${fromNow(
												issue.closedDate ?? issue.date,
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
														issueResult.value.closedDate ?? issueResult.value.date,
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
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageRegex'>;
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
	}

	return true;
}
