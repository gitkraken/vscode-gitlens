import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import { GlyphChars } from '../constants';
import type { IntegrationIds } from '../constants.integrations';
import { IssuesCloudHostIntegrationId } from '../constants.integrations';
import type { Container } from '../container';
import type { GitRemote } from '../git/models/remote';
import type { RemoteProvider, RemoteProviderId } from '../git/remotes/remoteProvider';
import { getIssueOrPullRequestHtmlIcon, getIssueOrPullRequestMarkdownIcon } from '../git/utils/-webview/icons';
import type { ConfiguredIntegrationsChangeEvent } from '../plus/integrations/authentication/configuredIntegrationService';
import type { GitHostIntegration } from '../plus/integrations/models/gitHostIntegration';
import type { Integration } from '../plus/integrations/models/integration';
import { IntegrationBase } from '../plus/integrations/models/integration';
import type { IssuesIntegration } from '../plus/integrations/models/issuesIntegration';
import {
	convertRemoteProviderIdToIntegrationId,
	getIntegrationIdForRemote,
} from '../plus/integrations/utils/-webview/integration.utils';
import { configuration } from '../system/-webview/configuration';
import { fromNow } from '../system/date';
import { debug } from '../system/decorators/log';
import { encodeUrl } from '../system/encoding';
import { join, map } from '../system/iterable';
import { Logger } from '../system/logger';
import { escapeMarkdown } from '../system/markdown';
import { getSettledValue, isPromise } from '../system/promise';
import { PromiseCache } from '../system/promiseCache';
import { capitalize, encodeHtmlWeak, getSuperscript } from '../system/string';
import type {
	Autolink,
	CacheableAutolinkReference,
	DynamicAutolinkReference,
	EnrichedAutolink,
	MaybeEnrichedAutolink,
	RefSet,
} from './models/autolinks';
import {
	ensureCachedRegex,
	getAutolinks,
	getBranchAutolinks,
	isDynamic,
	numRegex,
	supportedAutolinkIntegrations,
} from './utils/-webview/autolinks.utils';

const emptyAutolinkMap = Object.freeze(new Map<string, Autolink>());

export class AutolinksProvider implements Disposable {
	private _disposable: Disposable | undefined;
	private _references: CacheableAutolinkReference[] = [];
	private _refsetCache = new PromiseCache<string | undefined, RefSet[]>({ accessTTL: 1000 * 60 * 60 });

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.integrations.onDidChange(this.onIntegrationsChanged, this),
		);

		this.setAutolinksFromConfig();
	}

	dispose(): void {
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'autolinks')) {
			this.setAutolinksFromConfig();
			this._refsetCache.clear();
		}
	}

	private onIntegrationsChanged(_e: ConfiguredIntegrationsChangeEvent) {
		this._refsetCache.clear();
	}

	private setAutolinksFromConfig() {
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

	/** Collects connected integration autolink references into @param refsets */
	private async collectIntegrationAutolinks(remote: GitRemote | undefined, refsets: RefSet[]): Promise<void> {
		const integrationPromises: Promise<GitHostIntegration | IssuesIntegration | undefined>[] =
			supportedAutolinkIntegrations.map(async id => this.container.integrations.get(id));
		if (remote?.provider != null) {
			integrationPromises.push(remote.getIntegration());
		}

		const integrations = new Set<GitHostIntegration | IssuesIntegration>();
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
	private collectRemoteAutolinks(remote: GitRemote | undefined, refsets: RefSet[], forBranch?: boolean): void {
		if (remote?.provider?.autolinks.length) {
			let autolinks = remote.provider.autolinks;
			if (forBranch) {
				autolinks = autolinks.filter(autolink => !isDynamic(autolink) && autolink.referenceType === 'branch');
			}
			refsets.push([remote.provider, autolinks]);
		}
	}

	/** Collects custom-configured autolink references into @param refsets */
	private collectCustomAutolinks(refsets: RefSet[]): void {
		if (this._references.length) {
			refsets.push([undefined, this._references]);
		}
	}

	private async getRefSets(remote?: GitRemote, forBranch?: boolean) {
		return this._refsetCache.get(remote?.remoteKey, async () => {
			const refsets: RefSet[] = [];

			await this.collectIntegrationAutolinks(forBranch ? undefined : remote, refsets);
			this.collectRemoteAutolinks(remote, refsets, forBranch);
			this.collectCustomAutolinks(refsets);

			return refsets;
		});
	}

	/** @returns A sorted list of autolinks. the first match is the most relevant */
	async getBranchAutolinks(branchName: string, remote?: GitRemote): Promise<Map<string, Autolink>> {
		const refsets = await this.getRefSets(remote, true);
		if (refsets.length === 0) return emptyAutolinkMap;

		return getBranchAutolinks(branchName, refsets);
	}

	@debug<AutolinksProvider['getAutolinks']>({
		args: {
			0: '<message>',
			1: false,
		},
	})
	async getAutolinks(message: string, remote?: GitRemote): Promise<Map<string, Autolink>> {
		const refsets = await this.getRefSets(remote);
		if (refsets.length === 0) return emptyAutolinkMap;

		return getAutolinks(message, refsets);
	}

	getAutolinkEnrichableId(autolink: Autolink): string {
		switch (autolink.provider?.id) {
			case IssuesCloudHostIntegrationId.Jira:
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
	@debug<AutolinksProvider['getEnrichedAutolinks']>({
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
			let integrationId: IntegrationIds | undefined;
			let linkIntegration: Integration | undefined;
			if (link.provider != null) {
				// Try to make a smart choice
				integrationId =
					link.provider instanceof IntegrationBase
						? link.provider.id
						: // TODO: Tighten the typing on ProviderReference to be specific to a remote provider, and then have a separate "integration" property (on autolinks and elsewhere)
							// that is of a new type IntegrationReference specific to integrations. Otherwise, make remote provider ids line up directly with integration ids.
							// Either way, this converting/casting hackery needs to go away.
							(getIntegrationIdForRemote(link.provider as RemoteProvider) ??
							convertRemoteProviderIdToIntegrationId(link.provider.id as RemoteProviderId));
				if (integrationId == null) {
					// Fall back to the old logic assuming that integration id might be saved as provider id.
					// TODO: it should be removed when we put providers and integrations in order. Conversation: https://github.com/gitkraken/vscode-gitlens/pull/3996#discussion_r1936422826
					integrationId = link.provider.id as IntegrationIds;
				}
				try {
					linkIntegration = await this.container.integrations.get(integrationId);
				} catch (e) {
					Logger.error(e, `Failed to get integration for ${link.provider.id}`);
					linkIntegration = undefined;
				}
			}
			if (linkIntegration != null) {
				const connected = linkIntegration.maybeConnected ?? (await linkIntegration.isConnected());
				if (!connected || !(await linkIntegration.access())) {
					linkIntegration = undefined;
				}
			}
			const issueOrPullRequestPromise =
				remote?.provider != null &&
				integration != null &&
				integrationId === integration.id &&
				link.provider?.domain === integration.domain
					? integration.getIssueOrPullRequest(
							link.descriptor ?? remote.provider.repoDesc,
							this.getAutolinkEnrichableId(link),
							{ type: link.type },
						)
					: link.descriptor != null
						? linkIntegration?.getIssueOrPullRequest(link.descriptor, this.getAutolinkEnrichableId(link), {
								type: link.type,
							})
						: undefined;
			enrichedAutolinks.set(id, [issueOrPullRequestPromise, link]);
		}

		return enrichedAutolinks;
	}

	@debug<AutolinksProvider['linkify']>({
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

			if (remotes?.length) {
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
