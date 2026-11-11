import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, l10n } from 'vscode';
import type { DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProvider, RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import {
	formatPullRequestMergeQueueEnqueuedFromNow,
	formatPullRequestMergeQueueStatus,
	isPullRequestInMergeQueue,
} from '@gitlens/git/utils/pullRequest.utils.js';
import type { IntegrationIds } from '@gitlens/integrations/constants.js';
import type { GitHostIntegration } from '@gitlens/integrations/models/gitHostIntegration.js';
import type { Integration } from '@gitlens/integrations/models/integration.js';
import { IntegrationBase } from '@gitlens/integrations/models/integration.js';
import type { IssuesIntegration } from '@gitlens/integrations/models/issuesIntegration.js';
import {
	convertRemoteProviderIdToIntegrationId,
	getIntegrationIdForRemote,
} from '@gitlens/integrations/utils/integration.utils.js';
import { fromNow } from '@gitlens/utils/date.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { encodeUrl } from '@gitlens/utils/encoding.js';
import { join, map } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { escapeMarkdown, unescapeMarkdown } from '@gitlens/utils/markdown.js';
import { getSettledValue, isPromise } from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { ResourceUsage } from '@gitlens/utils/resourceUsage.js';
import { encodeHtmlWeak, getSuperscript } from '@gitlens/utils/string.js';
import type { OpenIssueActionContext } from '../api/gitlens.d.js';
import { OpenIssueOnRemoteCommand } from '../commands/openIssueOnRemote.js';
import { GlyphChars } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { getIssueOrPullRequestHtmlIcon, getIssueOrPullRequestMarkdownIcon } from '../git/utils/-webview/icons.js';
import { getRemoteIntegration, isRemoteMaybeIntegrationConnected } from '../git/utils/-webview/remote.utils.js';
import { configuration } from '../system/-webview/configuration.js';
import type {
	Autolink,
	EnrichedAutolink,
	GlCacheableAutolinkReference,
	GlDynamicAutolinkReference,
	MaybeEnrichedAutolink,
	RefSet,
} from './models/autolinks.js';
import {
	ensureCachedRegex,
	getAutolinks,
	getBranchAutolinks,
	isDynamic,
	numRegex,
	supportedAutolinkIntegrations,
} from './utils/-webview/autolinks.utils.js';

const emptyAutolinkMap = Object.freeze(new Map<string, Autolink>());
const tokenRegex = /(\x00\d+\x00)/g; // oxlint-disable-line no-control-regex

function escapeMarkdownTitle(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r\n|\r|\n/g, '&#10;');
}

function getAutolinkName(ref: GlCacheableAutolinkReference | Autolink, num: string): string {
	return ref.description?.replace(numRegex, num) ?? l10n.t('Custom Autolink {0}', `${ref.prefix}${num}`);
}

function getIssueStatusDescription(issue: IssueOrPullRequest, link?: string): string {
	if (issue.type === 'pullrequest' && isPullRequestInMergeQueue(issue)) {
		// Dated by when it joined the queue, since the status reads as what happened then
		const status = formatPullRequestMergeQueueStatus(issue.mergeQueue);
		const enqueued = formatPullRequestMergeQueueEnqueuedFromNow(issue.mergeQueue);
		return link == null ? l10n.t('{0}, {1}', status, enqueued) : l10n.t('{0} {1}, {2}', link, status, enqueued);
	}

	const date = fromNow(issue.closedDate ?? issue.createdDate);
	switch (issue.state) {
		case 'opened':
			return link == null ? l10n.t('Opened, {0}', date) : l10n.t('{0} opened {1}', link, date);
		case 'closed':
			return link == null ? l10n.t('Closed, {0}', date) : l10n.t('{0} closed {1}', link, date);
		case 'merged':
			return link == null ? l10n.t('Merged, {0}', date) : l10n.t('{0} merged {1}', link, date);
		default:
			return link ?? l10n.t('Unknown');
	}
}

export class AutolinksProvider implements Disposable {
	private _disposable: Disposable | undefined;
	private _references: GlCacheableAutolinkReference[] = [];
	// Keyed by the remote and the autolinks enriched, not the message: a tracker's autolinks change under the same
	// message (#6183). Bounded, since settled entries are kept until evicted.
	private _enrichedAutolinksCache = new PromiseCache<string, Map<string, EnrichedAutolink>>({
		createTTL: 1000 * 60 * 30, // 30 minutes
		capacity: 50,
	});

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.integrations.onDidChange(this.onIntegrationsChanged, this),
			container.integrations.onDidChangeConnectionState(this.onIntegrationsChanged, this),
		);

		this.setAutolinksFromConfig();
	}

	dispose(): void {
		this._disposable?.dispose();
		this._enrichedAutolinksCache.clear();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'autolinks')) {
			this.setAutolinksFromConfig();
			this._enrichedAutolinksCache.clear();
		}
	}

	private onIntegrationsChanged() {
		this._enrichedAutolinksCache.clear();
	}

	/** Resource usage retained by autolink caches and configuration. */
	getResourceUsage(): ResourceUsage {
		return {
			'enriched.entries.count': this._enrichedAutolinksCache.size,
			'configured.references.count': this._references.length,
		};
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
			integrationPromises.push(getRemoteIntegration(remote));
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

		if (!promises.length) return;

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

	/**
	 * Not cached: Jira and Linear own their autolinks' freshness (expiry, forced-refresh drops, missing-project
	 * evictions, retrying incomplete sets), so a cache here would serve a set they already replaced (#6183).
	 */
	private async getRefSets(remote?: GitRemote, forBranch?: boolean): Promise<RefSet[]> {
		const refsets: RefSet[] = [];

		await this.collectIntegrationAutolinks(forBranch ? undefined : remote, refsets);
		this.collectRemoteAutolinks(remote, refsets, forBranch);
		this.collectCustomAutolinks(refsets);

		return refsets;
	}

	/** @returns A sorted list of autolinks. the first match is the most relevant */
	async getBranchAutolinks(branchName: string, remote?: GitRemote): Promise<Map<string, Autolink>> {
		const refsets = await this.getRefSets(remote, true);
		if (!refsets.length) return emptyAutolinkMap;

		return getBranchAutolinks(branchName, refsets);
	}

	@trace({ args: () => ({ message: '<message>' }) })
	async getAutolinks(message: string, remote?: GitRemote): Promise<Map<string, Autolink>> {
		const refsets = await this.getRefSets(remote);
		if (!refsets.length) return emptyAutolinkMap;

		return getAutolinks(message, refsets);
	}

	getAutolinkEnrichableId(autolink: Autolink): { id: string; key: string } {
		return { id: autolink.id, key: `${autolink.prefix}${autolink.id}` };
	}

	getEnrichedAutolinks(
		message: string,
		remote: GitRemote | undefined,
		options?: { cached?: boolean },
	): Promise<Map<string, EnrichedAutolink> | undefined>;
	getEnrichedAutolinks(
		autolinks: Map<string, Autolink>,
		remote: GitRemote | undefined,
		options?: { cached?: boolean },
	): Promise<Map<string, EnrichedAutolink> | undefined>;
	@trace({
		args: (messageOrAutolinks, remote) => ({
			messageOrAutolinks:
				typeof messageOrAutolinks === 'string' ? '<message>' : `autolinks=${messageOrAutolinks.size}`,
			remote: remote?.remoteKey,
		}),
	})
	async getEnrichedAutolinks(
		messageOrAutolinks: string | Map<string, Autolink>,
		remote: GitRemote | undefined,
		options?: { cached?: boolean },
	): Promise<Map<string, EnrichedAutolink> | undefined> {
		const autolinks =
			typeof messageOrAutolinks === 'string'
				? await this.getAutolinks(messageOrAutolinks, remote)
				: messageOrAutolinks;
		if (!autolinks.size) return undefined;

		// Every field the cached links render or are looked up with; their descriptor and domain follow from the url
		// and the remote. Neither the id (`PROJ-2` and `NEW-2` both parse to `2`) nor the url (`#12` and `gh-12` share
		// one) tells two links apart on its own
		const links = Array.from(autolinks, ([id, link]) =>
			JSON.stringify([
				id,
				link.provider?.id,
				link.prefix,
				link.url,
				link.type,
				link.alphanumeric,
				link.ignoreCase,
				link.title,
				link.description,
			]),
		);
		const key = `${remote?.remoteKey ?? ''}:${links.sort().join(',')}`;
		// A peek never starts an issue lookup; parsing a message above waits on a tracker's discovery build only while it
		// holds no set for its token (first use, or after a forced refresh, an eviction or a project or team list change)
		if (options?.cached) return this._enrichedAutolinksCache.get(key);

		// Trace-gated (noisy — fires on every cache miss): tracks retained cache state over time — entry count
		// (pinned at capacity means evictions are active) and total retained key bytes, since keys can be large
		// (compare ranges enrich every link in the range as one set).
		if (Logger.enabled('trace')) {
			let keyBytes = 0;
			for (const cachedKey of this._enrichedAutolinksCache.keys()) {
				keyBytes += cachedKey.length;
			}
			Logger.trace(
				undefined,
				`AutolinksProvider._enrichedAutolinksCache: entries=${this._enrichedAutolinksCache.size}, keyBytes=${keyBytes}, newKeyBytes=${key.length}`,
			);
		}

		const failures: Promise<boolean>[] = [];
		return this._enrichedAutolinksCache.getOrCreate(
			key,
			() => this.enrichAutolinksCore(autolinks, remote, failures),
			// A failed lookup resolves to `undefined` for callers, but must not be retained as the answer
			{ evictWhen: async () => (await Promise.all(failures)).some(Boolean) },
		);
	}

	private async enrichAutolinksCore(
		autolinks: Map<string, Autolink>,
		remote: GitRemote | undefined,
		failures: Promise<boolean>[],
	): Promise<Map<string, EnrichedAutolink>> {
		let integration = remote != null ? await getRemoteIntegration(remote) : undefined;
		if (integration != null) {
			const connected = integration.maybeConnected ?? (await integration.isConnected());
			if (!connected || !(await integration.access())) {
				integration = undefined;
			}
		}

		const enrichedAutolinks = new Map<string, EnrichedAutolink>();
		for (const [id, link] of autolinks) {
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
				// Fall back to the old logic assuming that integration id might be saved as provider id.
				// TODO: it should be removed when we put providers and integrations in order. Conversation: https://github.com/gitkraken/vscode-gitlens/pull/3996#discussion_r1936422826
				integrationId ??= link.provider.id as IntegrationIds;
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
					? integration.getLinkedIssueOrPullRequest(
							link.descriptor ?? remote.provider.repoDesc,
							this.getAutolinkEnrichableId(link),
							{ type: link.type, throwOnError: true },
						)
					: link.descriptor != null
						? linkIntegration?.getLinkedIssueOrPullRequest(
								link.descriptor,
								this.getAutolinkEnrichableId(link),
								{
									type: link.type,
									throwOnError: true,
								},
							)
						: undefined;

			if (issueOrPullRequestPromise != null) {
				// Track the raw outcome for cache eviction, but never let a rejection reach consumers of the map
				failures.push(
					issueOrPullRequestPromise.then(
						() => false,
						() => true,
					),
				);
			}

			enrichedAutolinks.set(id, [issueOrPullRequestPromise?.catch(() => undefined), link]);
		}

		return enrichedAutolinks;
	}

	@trace({
		args: (_text, outputFormat, remotes, enrichedAutolinks, prs) => ({
			text: '<text>',
			outputFormat: outputFormat,
			remotes: remotes?.length,
			enrichedAutolinks: enrichedAutolinks?.size,
			prs: prs?.size,
		}),
	})
	linkify(
		text: string,
		outputFormat: 'html' | 'markdown' | 'plaintext',
		remotes?: GitRemote[],
		enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
		prs?: Set<string>,
		footnotes?: Map<number, string>,
		source?: Source,
	): string {
		const includeFootnotesInText = outputFormat === 'plaintext' && footnotes == null;
		if (includeFootnotesInText) {
			footnotes = new Map<number, string>();
		}

		const tokenMapping = new Map<string, string>();

		if (enrichedAutolinks?.size) {
			for (const [, [, link]] of enrichedAutolinks) {
				if (this.ensureAutolinkRegexCached(link)) {
					text = renderCacheableAutolink(
						link,
						text,
						outputFormat,
						tokenMapping,
						enrichedAutolinks,
						prs,
						footnotes,
						source,
					);
				}
			}
		} else {
			for (const ref of this._references) {
				if (this.ensureAutolinkRegexCached(ref)) {
					text = renderCacheableAutolink(
						ref,
						text,
						outputFormat,
						tokenMapping,
						enrichedAutolinks,
						prs,
						footnotes,
						source,
					);
				}
			}

			if (remotes?.length) {
				remotes = remotes.toSorted((a, b) => {
					const aConnected = isRemoteMaybeIntegrationConnected(a);
					const bConnected = isRemoteMaybeIntegrationConnected(b);
					return aConnected !== bConnected ? (aConnected ? -1 : bConnected ? 1 : 0) : 0;
				});
				for (const r of remotes) {
					if (r.provider == null) continue;

					for (const ref of r.provider.autolinks) {
						if (isDynamic(ref)) {
							text = renderDynamicAutolink(
								ref,
								text,
								outputFormat,
								tokenMapping,
								enrichedAutolinks,
								prs,
								footnotes,
							);
						} else if (this.ensureAutolinkRegexCached(ref)) {
							text = renderCacheableAutolink(
								ref,
								text,
								outputFormat,
								tokenMapping,
								enrichedAutolinks,
								prs,
								footnotes,
								source,
							);
						}
					}
				}
			}
		}

		if (tokenMapping.size) {
			text = text.replace(tokenRegex, (_, t: string) => tokenMapping.get(t) ?? t);
		}

		if (includeFootnotesInText && footnotes?.size) {
			text += `\n${GlyphChars.Dash.repeat(2)}\n${join(
				map(footnotes, ([i, footnote]) => `${getSuperscript(i)} ${footnote}`),
				'\n',
			)}`;
		}

		return text;
	}

	private ensureAutolinkRegexCached(
		ref: GlCacheableAutolinkReference | GlDynamicAutolinkReference | Autolink,
	): ref is GlCacheableAutolinkReference | Autolink {
		if (isDynamic(ref)) return false;
		if (!ref.prefix || !ref.url) return false;

		try {
			ensureCachedRegex(ref, 'markdown');
			ensureCachedRegex(ref, 'html');
			ensureCachedRegex(ref, 'plaintext');
		} catch (ex) {
			Logger.error(
				ex,
				`Failed to cache autolink regex: prefix=${ref.prefix}, url=${ref.url}, title=${ref.title}`,
			);
			return false;
		}

		return true;
	}
}

function renderCacheableAutolink(
	ref: GlCacheableAutolinkReference | Autolink,
	text: string,
	outputFormat: 'html' | 'markdown' | 'plaintext',
	tokenMapping: Map<string, string>,
	enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
	prs?: Set<string>,
	footnotes?: Map<number, string>,
	source?: Source,
): string {
	let footnoteIndex: number;

	switch (outputFormat) {
		case 'markdown':
			ensureCachedRegex(ref, outputFormat);
			return text.replace(
				ref.messageMarkdownRegex,
				(_: string, prefix: string, linkText: string, num: string) => {
					const rawUrl = encodeUrl(ref.url.replace(numRegex, num));
					const footnoteSource = source && { ...source, detail: 'footnote' };
					const urlCommandContext: {
						provider: undefined | OpenIssueActionContext['provider'];
						issue: { url: string };
					} = {
						provider: undefined,
						issue: { url: rawUrl },
					};

					let title = '';
					if (ref.title) {
						title = ` "${escapeMarkdownTitle(ref.title.replace(numRegex, num))}`;

						const issueResult = enrichedAutolinks?.get(num)?.[0];
						if (issueResult?.value != null) {
							if (issueResult.paused) {
								if (footnotes != null && !prs?.has(num)) {
									const url = OpenIssueOnRemoteCommand.createMarkdownCommandLink({
										...urlCommandContext,
										source: footnoteSource,
									});
									const name = escapeMarkdown(getAutolinkName(ref, num));
									footnoteIndex = footnotes.size + 1;
									footnotes.set(
										footnoteIndex,
										`[${getIssueOrPullRequestMarkdownIcon()} ${name} $(loading~spin)](${url}${title}")`,
									);
								}

								title += `\n${GlyphChars.Dash.repeat(2)}\n${escapeMarkdownTitle(l10n.t('Loading...'))}`;
							} else {
								const issue = issueResult.value;
								const issueTitle = escapeMarkdown(issue.title.trim());
								const issueTitleQuoteEscaped = escapeMarkdownTitle(issue.title.trim());

								urlCommandContext.provider = issue.provider && {
									id: issue.provider.id,
									name: issue.provider.name,
									domain: issue.provider.domain,
								};
								const url = OpenIssueOnRemoteCommand.createMarkdownCommandLink({
									...urlCommandContext,
									source: footnoteSource,
								});

								if (footnotes != null && !prs?.has(num)) {
									footnoteIndex = footnotes.size + 1;
									footnotes.set(
										footnoteIndex,
										`[${getIssueOrPullRequestMarkdownIcon(
											issue,
										)} **${issueTitle}**](${url}${title}")\\\n${GlyphChars.Space.repeat(
											5,
										)}${escapeMarkdown(getIssueStatusDescription(issue, unescapeMarkdown(linkText)))}`,
									);
								}

								title += `\n${GlyphChars.Dash.repeat(
									2,
								)}\n${issueTitleQuoteEscaped}\n${escapeMarkdownTitle(getIssueStatusDescription(issue))}`;
							}
						} else if (footnotes != null && !prs?.has(num)) {
							const url = OpenIssueOnRemoteCommand.createMarkdownCommandLink({
								...urlCommandContext,
								source: footnoteSource,
							});
							const name = escapeMarkdown(getAutolinkName(ref, num));
							footnoteIndex = footnotes.size + 1;
							footnotes.set(
								footnoteIndex,
								`[${getIssueOrPullRequestMarkdownIcon()} ${name}](${url}${title}")`,
							);
						}
						title += '"';
					}

					const url = OpenIssueOnRemoteCommand.createMarkdownCommandLink({
						...urlCommandContext,
						source: source,
					});
					const token = `\x00${tokenMapping.size}\x00`;
					tokenMapping.set(token, `[${linkText}](${url}${title})`);
					return `${prefix}${token}`;
				},
			);

		case 'html':
			ensureCachedRegex(ref, outputFormat);
			return text.replace(ref.messageHtmlRegex, (_: string, prefix: string, linkText: string, num: string) => {
				const url = encodeUrl(ref.url.replace(numRegex, num));

				let title = '';
				if (ref.title) {
					title = `"${encodeHtmlWeak(ref.title.replace(numRegex, num))}`;

					const issueResult = enrichedAutolinks?.get(num)?.[0];
					if (issueResult?.value != null) {
						if (issueResult.paused) {
							if (footnotes != null && !prs?.has(num)) {
								const name = encodeHtmlWeak(getAutolinkName(ref, num));
								footnoteIndex = footnotes.size + 1;
								footnotes.set(
									footnoteIndex,
									`<a href="${url}" title=${title}">${getIssueOrPullRequestHtmlIcon()} ${name}</a>`,
								);
							}

							title += `\n${GlyphChars.Dash.repeat(2)}\n${encodeHtmlWeak(l10n.t('Loading...'))}`;
						} else {
							const issue = issueResult.value;
							const issueTitle = encodeHtmlWeak(issue.title.trim());

							if (footnotes != null && !prs?.has(num)) {
								footnoteIndex = footnotes.size + 1;
								footnotes.set(
									footnoteIndex,
									`<a href="${url}" title=${title}">${getIssueOrPullRequestHtmlIcon(
										issue,
									)} <b>${issueTitle}</b></a><br /><span>${GlyphChars.Space.repeat(
										5,
									)}${encodeHtmlWeak(getIssueStatusDescription(issue, '{autolink}')).replaceAll('{autolink}', () => linkText)}</span>`,
								);
							}

							title += `\n${GlyphChars.Dash.repeat(
								2,
							)}\n${issueTitle}\n${encodeHtmlWeak(getIssueStatusDescription(issue))}`;
						}
					} else if (footnotes != null && !prs?.has(num)) {
						const name = encodeHtmlWeak(getAutolinkName(ref, num));
						footnoteIndex = footnotes.size + 1;
						footnotes.set(
							footnoteIndex,
							`<a href="${url}" title=${title}">${getIssueOrPullRequestHtmlIcon()} ${name}</a>`,
						);
					}
					title += '"';
				}

				const token = `\x00${tokenMapping.size}\x00`;
				tokenMapping.set(token, `<a href="${url}"${title ? ` title=${title}` : ''}>${linkText}</a>`);
				return `${prefix}${token}`;
			});

		default:
			ensureCachedRegex(ref, outputFormat);
			return text.replace(ref.messageRegex, (_: string, prefix: string, linkText: string, num: string) => {
				const issueResult = enrichedAutolinks?.get(num)?.[0];
				if (issueResult?.value == null) return linkText;

				if (footnotes != null && !prs?.has(num)) {
					footnoteIndex = footnotes.size + 1;
					footnotes.set(
						footnoteIndex,
						`${linkText}: ${
							issueResult.paused
								? l10n.t('Loading...')
								: `${issueResult.value.title}  ${GlyphChars.Dot}  ${getIssueStatusDescription(issueResult.value)}`
						}`,
					);
				}

				const token = `\x00${tokenMapping.size}\x00`;
				tokenMapping.set(token, `${linkText}${getSuperscript(footnoteIndex)}`);
				return `${prefix}${token}`;
			});
	}
}

function renderDynamicAutolink(
	ref: DynamicAutolinkReference,
	text: string,
	outputFormat: 'html' | 'markdown' | 'plaintext',
	tokenMapping: Map<string, string>,
	enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
	prs?: Set<string>,
	footnotes?: Map<number, string>,
): string {
	if (outputFormat === 'plaintext' || !ref.descriptors?.length) return text;

	for (const desc of ref.descriptors) {
		desc.regex.lastIndex = 0;
		text = text.replace(desc.regex, (linkText: string, repo: string, num: string) => {
			const url = encodeUrl(desc.url(unescapeMarkdown(repo), num));
			const rawTitle = desc.title(repo, num);
			const title = ` "${escapeMarkdownTitle(rawTitle)}"`;

			const token = `\x00${tokenMapping.size}\x00`;
			if (outputFormat === 'markdown') {
				tokenMapping.set(token, `[${linkText}](${url}${title})`);
			} else {
				tokenMapping.set(token, `<a href="${url}" title="${encodeHtmlWeak(rawTitle)}">${linkText}</a>`);
			}

			appendFootnote(
				escapeMarkdown(desc.label(repo, num)),
				num,
				url,
				title,
				linkText,
				enrichedAutolinks,
				prs,
				footnotes,
			);
			return token;
		});
	}

	return text;
}

function appendFootnote(
	label: string,
	num: string,
	url: string,
	title: string,
	linkText: string,
	enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
	prs?: Set<string>,
	footnotes?: Map<number, string>,
): void {
	if (footnotes == null || prs?.has(num)) return;

	const issueResult = enrichedAutolinks?.get(num)?.[0];
	if (issueResult?.value != null) {
		if (issueResult.paused) {
			const footnoteIndex = footnotes.size + 1;
			footnotes.set(
				footnoteIndex,
				`[${getIssueOrPullRequestMarkdownIcon()} ${label} $(loading~spin)](${url}${title})`,
			);
		} else {
			const issue = issueResult.value;
			const issueTitle = escapeMarkdown(issue.title.trim());
			const footnoteIndex = footnotes.size + 1;
			footnotes.set(
				footnoteIndex,
				`[${getIssueOrPullRequestMarkdownIcon(issue)} **${issueTitle}**](${url}${title})\\\n${GlyphChars.Space.repeat(5)}${escapeMarkdown(getIssueStatusDescription(issue, unescapeMarkdown(linkText)))}`,
			);
		}
	} else {
		const footnoteIndex = footnotes.size + 1;
		footnotes.set(footnoteIndex, `[${getIssueOrPullRequestMarkdownIcon()} ${label}](${url}${title})`);
	}
}
