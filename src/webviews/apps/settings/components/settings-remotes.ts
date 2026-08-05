import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { areEqual } from '@gitlens/utils/object.js';
import type { CustomRemoteType, RemotesUrlsConfig } from '../../../../config.js';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { RemoteRuleDraft, SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import type { MatcherMode, RemoteDraft } from './settings-remotes.utils.js';
import { findEntryIndex, isEntryLive, isPersistable, projectEntry, urlsComplete } from './settings-remotes.utils.js';
import '../../shared/components/button.js';
import '../../shared/components/checkbox/checkbox.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/segmented/segmented.js';
import '../../shared/components/select/select.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-remotes']: GlSettingsRemotes;
	}
}

/** Provider type options, ordered by how commonly they're self-hosted (most common first). */
const typeOptions: { value: CustomRemoteType; label: string }[] = [
	{ value: 'GitHub', label: 'GitHub' },
	{ value: 'GitLab', label: 'GitLab' },
	{ value: 'Bitbucket', label: 'Bitbucket' },
	{ value: 'BitbucketServer', label: 'Bitbucket Server' },
	{ value: 'AzureDevOps', label: 'Azure DevOps' },
	{ value: 'Gitea', label: 'Gitea' },
	{ value: 'Gerrit', label: 'Gerrit' },
	{ value: 'GoogleSource', label: 'Google Source' },
	{ value: 'Custom', label: 'Custom' },
];

const typeLabels = new Map(typeOptions.map(o => [o.value, o.label]));

/** Options for the domain/regex matcher-mode segmented control. */
const matcherModeOptions: { value: MatcherMode; label: string }[] = [
	{ value: 'domain', label: 'Domain' },
	{ value: 'regex', label: 'Regex' },
];

/**
 * Provider types whose self-hosted URLs are path-structural (the built-in matchers
 * use URL regexes, `matcher.ts:57-58`), so an exact-domain matcher — which only
 * compares the host by equality (`matcher.ts:161`) — usually won't resolve their
 * links. The editor steers these toward the regex matcher.
 */
const serverStyleTypes = new Set<CustomRemoteType>(['BitbucketServer', 'Gerrit', 'AzureDevOps']);

/**
 * The `urls` template fields, in editor order, each with the interpolation tokens
 * its consumer (`custom.ts`) actually supplies for that URL — NOT the CommitFormatter
 * tokens. `${repo}` is available to every template.
 */
/* eslint-disable no-template-curly-in-string -- the token strings are literal `${...}` template syntax shown to the user, not JS interpolation */
const urlFields: { key: keyof RemotesUrlsConfig; label: string; required: boolean; tokens: string[] }[] = [
	{ key: 'repository', label: 'Repository', required: true, tokens: ['${repo}'] },
	{ key: 'branches', label: 'Branches', required: true, tokens: ['${repo}'] },
	{ key: 'branch', label: 'Branch', required: true, tokens: ['${repo}', '${branch}'] },
	{ key: 'commit', label: 'Commit', required: true, tokens: ['${repo}', '${id}'] },
	{ key: 'file', label: 'File', required: true, tokens: ['${repo}', '${file}', '${line}'] },
	{
		key: 'fileInBranch',
		label: 'File (in branch)',
		required: true,
		tokens: ['${repo}', '${branch}', '${file}', '${line}'],
	},
	{
		key: 'fileInCommit',
		label: 'File (in commit)',
		required: true,
		tokens: ['${repo}', '${id}', '${file}', '${line}'],
	},
	{ key: 'fileLine', label: 'File line', required: true, tokens: ['${line}'] },
	{ key: 'fileRange', label: 'File range', required: true, tokens: ['${start}', '${end}'] },
	{
		key: 'comparison',
		label: 'Comparison',
		required: false,
		tokens: ['${repo}', '${ref1}', '${ref2}', '${notation}'],
	},
	{
		key: 'createPullRequest',
		label: 'Create pull request',
		required: false,
		tokens: ['${repo}', '${base}', '${head}'],
	},
	{ key: 'avatar', label: 'Avatar', required: false, tokens: ['${email}', '${emailName}', '${domain}', '${size}'] },
];
/* eslint-enable no-template-curly-in-string */

/**
 * The custom-remotes editor — add/edit/remove `gitlens.remotes` entries.
 *
 * Collapsed rows summarize each entry (type + matcher); one row expands at a time
 * (accordion) into a full editor: the matcher toggle (domain⇄regex), name/protocol/
 * ignore-SSL, and — only for `type: Custom` — the `urls` template block.
 *
 * Persistence mirrors the autolinks editor: every commit rewrites the whole array
 * via {@link SettingsActions.applyRemoteRule} (whole-entry, never a single property,
 * so a matcher-mode switch can't leave a stale `domain`/`regex` behind). An entry is
 * only persisted once it would survive the permissive consumer — it has a matcher,
 * and (for `type: Custom`) a complete `urls` block. A non-compiling regex is written
 * anyway and warned about (the consumer safely skips + logs it), matching autolinks'
 * write-and-warn model.
 */
@customElement('gl-settings-remotes')
export class GlSettingsRemotes extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-12);
			}

			.rules {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
			}

			.rule {
				border: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			.rule__summary {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-6) var(--gl-space-8);
			}

			.rule__expander {
				display: inline-flex;
				flex: none;
				align-items: center;
				justify-content: center;
				padding: var(--gl-space-4);
				color: var(--color-foreground--65);
				cursor: pointer;
				background: transparent;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.rule__expander:hover {
				color: var(--color-foreground);
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.rule__expander:focus-visible {
				${focusOutline}
			}

			.rule__title {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				font-size: 1.25rem;
				color: var(--color-foreground);
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.rule__title-type {
				font-weight: 600;
			}

			.rule__title-matcher {
				color: var(--color-foreground--65);
			}

			.rule__title-matcher code {
				font-family: var(--vscode-editor-font-family);
				font-size: 1.1rem;
			}

			.rule__title-unset {
				font-style: italic;
				color: var(--color-foreground--50);
			}

			.rule__delete {
				flex: none;
				padding: var(--gl-space-4);
				color: var(--color-foreground--50);
				cursor: pointer;
				background: transparent;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.rule__delete:hover {
				color: var(--color-foreground);
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.rule__delete:focus-visible {
				${focusOutline}
			}

			.rule__editor {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-12);
				padding: var(--gl-space-12);
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}

			.field {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
			}

			.field__label {
				font-size: 1.2rem;
				color: var(--color-foreground);
			}

			.field__row {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-8);
				align-items: center;
			}

			input[type='text'] {
				flex: 1;
				min-width: 20rem;
				padding: var(--gl-space-6) var(--gl-space-8);
				font-family: var(--vscode-editor-font-family);
				font-size: 1.2rem;
				color: var(--vscode-input-foreground);
				background-color: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-input-border-radius, 0.4rem);
			}

			input[type='text']:focus {
				${focusOutline}
			}

			input.invalid {
				border-color: var(--vscode-inputValidation-errorBorder);
			}

			.subfields {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-12);
			}

			.subfields .field {
				flex: 1;
				min-width: 16rem;
			}

			.urls {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-10);
				padding-block-start: var(--gl-space-8);
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}

			.urls__heading {
				font-size: 1.2rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.field__tokens {
				font-size: 1.1rem;
				color: var(--color-foreground--65);
			}

			.field__tokens code {
				font-family: var(--vscode-editor-font-family);
				font-size: 1.05rem;
			}

			.notice {
				display: flex;
				gap: var(--gl-space-6);
				align-items: flex-start;
				font-size: 1.15rem;
				line-height: 1.5;
			}

			.notice code-icon {
				flex: none;
				margin-block-start: 0.1rem;
			}

			.notice--warning {
				color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
			}

			.notice--hint {
				color: var(--color-foreground--65);
			}

			.hint {
				font-size: 1.15rem;
				line-height: 1.5;
				color: var(--color-foreground--65);
			}

			gl-button {
				align-self: flex-start;
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	actions?: SettingsActions;

	@query('gl-button')
	private _addButton?: HTMLElement;

	/**
	 * The row currently open for editing (accordion — at most one). A brand-new row
	 * lives here until its first persist; an existing row is loaded here on expand so
	 * the matcher-mode toggle and in-progress (not-yet-valid) edits have somewhere to
	 * live without clobbering the persisted config.
	 */
	@state()
	private _draft?: RemoteDraft;

	/** Config index the draft maps to; equals `remotes.length` for a not-yet-persisted new row. */
	@state()
	private _draftIndex?: number;

	/** True until the draft's first persist (so deleting it needs no config write). */
	private _draftIsNew = false;

	/**
	 * The projected persisted entry the open draft currently maps to (unset for a new
	 * row). Config is the source of truth for what's live; this is how we tell whether
	 * a `remotes` change was our own write settling or an external `settings.json` edit
	 * that shifted/removed the entry we're editing — see {@link willUpdate}.
	 */
	private _draftBaseline?: RemoteRuleDraft;

	/** Transient notice shown when an external edit forced an open draft to be discarded. */
	@state()
	private _externalNotice?: string;

	private get remotes(): RemoteRuleDraft[] {
		return this._state.getSettingValue<RemoteRuleDraft[]>('remotes') ?? [];
	}

	override willUpdate(): void {
		// Reading the signal here subscribes the component, so an external `settings.json`
		// edit to `gitlens.remotes` re-runs this reconciliation for an open persisted row.
		const remotes = this.remotes;

		// Only a persisted, open row reconciles against config — a brand-new draft owns
		// its appended slot and has no baseline yet.
		if (this._draft == null || this._draftIsNew || this._draftIndex == null) return;

		const current = remotes[this._draftIndex];
		// Still what we last synced to — nothing external changed.
		if (current != null && areEqual(current, this._draftBaseline)) return;

		// Our own optimistic write (or its echo) landing in this slot — adopt it as the
		// new baseline rather than mistaking an in-flight commit for an external change.
		if (current != null && areEqual(current, projectEntry(this._draft))) {
			this._draftBaseline = projectEntry(this._draft);
			return;
		}

		// The slot changed to something we didn't cause. If our entry merely shifted
		// position, follow it; otherwise it was removed or changed out from under us —
		// discard the now-stale in-progress edit and say why.
		const relocated = findEntryIndex(remotes, this._draftBaseline);
		if (relocated !== -1) {
			this._draftIndex = relocated;
			return;
		}

		this._draft = undefined;
		this._draftIndex = undefined;
		this._draftIsNew = false;
		this._draftBaseline = undefined;
		this._externalNotice = 'This remote was changed outside the editor, so your unsaved edits were discarded.';
	}

	private addDraftRule = (): void => {
		this._externalNotice = undefined;
		// Never discard an unconfirmed new draft — just refocus it
		if (!(this._draftIsNew && this._draft != null)) {
			this._draft = { type: 'GitHub', matcherMode: 'domain' };
			this._draftIndex = this.remotes.length;
			this._draftIsNew = true;
			this._draftBaseline = undefined;
		}
		void this.updateComplete.then(() => {
			this.renderRoot
				.querySelector<HTMLElement>(`.rule[data-index="${this._draftIndex}"] .rule__type gl-select`)
				?.focus();
		});
	};

	private toggleExpand(index: number): void {
		this._externalNotice = undefined;
		if (this._draftIndex === index && this._draft != null) {
			// Collapse — a persisted row keeps its config value; an unsaved new row is discarded
			this._draft = undefined;
			this._draftIndex = undefined;
			this._draftIsNew = false;
			this._draftBaseline = undefined;
			return;
		}

		const entry = this.remotes[index];
		if (entry == null) return;

		this._draft = {
			...entry,
			// A persisted entry has exactly one matcher; regex wins if somehow both are present
			matcherMode: entry.regex ? 'regex' : 'domain',
		};
		this._draftIndex = index;
		this._draftIsNew = false;
		// The persisted entry the draft is layered over; reconciliation tracks it (willUpdate)
		this._draftBaseline = { ...entry };
	}

	/**
	 * Updates the draft and persists it when it would survive the consumer. The draft is
	 * a staged edit over the persisted entry; a not-yet-valid edit is held locally while
	 * config keeps whatever is live, and a new row is only promoted once its write lands.
	 */
	private async commit(patch: Partial<RemoteDraft>): Promise<void> {
		if (this._draft == null || this._draftIndex == null) return;

		const draft: RemoteDraft = { ...this._draft, ...patch };
		this._draft = draft;

		if (!isPersistable(draft)) {
			// Not yet valid — hold the edit locally (the editor body shows what's still
			// live and that the edit is unsaved); don't write an entry the consumer would
			// silently drop
			return;
		}

		const projected = projectEntry(draft);

		if (this._draftIsNew) {
			// Append at the current end, but only promote to a persisted row once the write
			// confirms — a failed/refused write leaves `_draftIsNew` set so the append block
			// keeps rendering the user's typed row instead of orphaning it out of every path.
			const targetIndex = this.remotes.length;
			if (await this.actions?.applyRemoteRule(targetIndex, projected)) {
				this._draftIsNew = false;
				this._draftIndex = targetIndex;
				this._draftBaseline = projected;
			}
			return;
		}

		if (await this.actions?.applyRemoteRule(this._draftIndex, projected)) {
			this._draftBaseline = projected;
		}
	}

	private setMatcherMode(mode: MatcherMode): void {
		if (this._draft == null || this._draft.matcherMode === mode) return;

		// Clear the now-inactive matcher so a switch can't persist both
		void this.commit(
			mode === 'regex' ? { matcherMode: mode, domain: undefined } : { matcherMode: mode, regex: undefined },
		);
	}

	private commitUrl(field: keyof RemotesUrlsConfig, value: string): void {
		if (this._draft == null) return;

		// Omit the key entirely when cleared (rather than writing an empty string) so an
		// optional URL template drops out and a required one reads as missing
		const { [field]: _removed, ...rest } = (this._draft.urls ?? {}) as Record<string, string>;
		const urls: Record<string, string> = value ? { ...rest, [field]: value } : rest;
		void this.commit({ urls: urls as unknown as RemotesUrlsConfig });
	}

	private removeRule(index: number): void {
		this._externalNotice = undefined;
		const editingThis = this._draftIndex === index && this._draft != null;
		const wasNew = this._draftIsNew;

		if (editingThis) {
			this._draft = undefined;
			this._draftIndex = undefined;
			this._draftIsNew = false;
			this._draftBaseline = undefined;
		} else if (this._draftIndex != null && index < this._draftIndex) {
			// A removal before the open row shifts its config index down by one; its
			// content is unchanged, so the baseline stays valid
			this._draftIndex -= 1;
		}

		// A never-persisted new row has no config entry to remove
		if (!(editingThis && wasNew)) {
			void this.actions?.removeRemote(index);
		}

		// The focused control is destroyed with the row — land on the row above, else the Add button
		void this.updateComplete.then(() => {
			const prev =
				index > 0
					? this.renderRoot.querySelector<HTMLElement>(`.rule[data-index="${index - 1}"] .rule__expander`)
					: null;
			(prev ?? this._addButton)?.focus();
		});
	}

	private renderSummary(entry: RemoteRuleDraft, index: number, expanded: boolean) {
		const typeLabel = typeLabels.get(entry.type) ?? entry.type;
		const matcher = entry.regex || entry.domain;
		const name = entry.name?.trim();

		return html`<div class="rule__summary">
			<button
				type="button"
				class="rule__expander"
				aria-expanded=${expanded ? 'true' : 'false'}
				aria-controls=${expanded ? `remote-${index}-editor` : nothing}
				aria-label="${expanded ? 'Collapse' : 'Expand'} ${typeLabel} remote"
				@click=${() => this.toggleExpand(index)}
			>
				<code-icon icon=${expanded ? 'chevron-down' : 'chevron-right'} aria-hidden="true"></code-icon>
			</button>
			<span class="rule__title">
				<span class="rule__title-type">${name || typeLabel}</span>
				${
					matcher
						? html`<span class="rule__title-matcher"> — <code>${matcher}</code></span>`
						: html`<span class="rule__title-unset"> — no matcher yet</span>`
				}
			</span>
			<button
				type="button"
				class="rule__delete"
				aria-label="Delete ${name || typeLabel} remote"
				title="Delete remote"
				@click=${() => this.removeRule(index)}
			>
				<code-icon icon="close" aria-hidden="true"></code-icon>
			</button>
		</div>`;
	}

	private renderEditor(draft: RemoteDraft, index: number) {
		const isCustom = draft.type === 'Custom';
		const isRegex = draft.matcherMode === 'regex';
		const matcherValue = isRegex ? (draft.regex ?? '') : (draft.domain ?? '');
		const matcherMissing = !matcherValue;
		const regexBroken = isRegex && draft.regex != null && draft.regex.length > 0 && !regexCompiles(draft.regex);
		const serverStyleDomain = draft.matcherMode === 'domain' && serverStyleTypes.has(draft.type);
		const typeLabel = typeLabels.get(draft.type) ?? draft.type;
		const urlsIncomplete = isCustom && !urlsComplete(draft.urls);

		// Config is the source of truth for what's live. When the saved entry backing
		// this row still resolves in the consumer, an invalid in-progress edit doesn't
		// take anything offline — the saved matcher stays live until the edit is valid,
		// so say that honestly instead of the (untrue) "this entry is ignored" line.
		const saved = this._draftIsNew ? undefined : this.remotes[index];
		const savedMatcher = saved?.regex || saved?.domain;
		const editShadowsLive = !isPersistable(draft) && isEntryLive(saved);

		return html`<div class="rule__editor" id="remote-${index}-editor">
			<div class="field rule__type">
				<label class="field__label" for="remote-${index}-type">Provider type</label>
				<gl-select
					id="remote-${index}-type"
					label="Provider type"
					.options=${typeOptions}
					.value=${draft.type}
					@gl-change-value=${(e: Event) =>
						this.commit({ type: (e.target as HTMLElement & { value: string }).value as CustomRemoteType })}
				></gl-select>
			</div>

			<div class="field">
				<span class="field__label">Match remotes by</span>
				<div class="field__row">
					<gl-segmented-control
						label="Matcher type"
						.options=${matcherModeOptions}
						.value=${draft.matcherMode}
						@gl-change-value=${(e: Event) =>
							this.setMatcherMode((e.target as HTMLElement & { value: string }).value as MatcherMode)}
					></gl-segmented-control>
					<input
						class="${matcherMissing || regexBroken ? 'invalid' : ''}"
						type="text"
						spellcheck="false"
						placeholder=${isRegex ? '\\bgit\\.example\\.com\\b' : 'git.example.com'}
						aria-label=${isRegex ? 'Match regex' : 'Match domain'}
						.value=${matcherValue}
						@blur=${(e: FocusEvent) =>
							this.commit(
								isRegex
									? { regex: (e.target as HTMLInputElement).value }
									: { domain: (e.target as HTMLInputElement).value },
							)}
					/>
				</div>
				${
					editShadowsLive
						? html`<p class="notice notice--hint">
								<code-icon icon="info" aria-hidden="true"></code-icon>
								<span
									>Unsaved changes — the saved matcher <code>${savedMatcher}</code> stays in effect
									until this edit is valid.</span
								>
							</p>`
						: matcherMissing
							? html`<p class="notice notice--hint">
									<code-icon icon="info" aria-hidden="true"></code-icon>
									<span
										>Add a ${isRegex ? 'regex' : 'domain'} to match remotes — until then this entry
										is ignored.</span
									>
								</p>`
							: nothing
				}
				${
					regexBroken
						? html`<p class="notice notice--warning">
								<code-icon icon="warning" aria-hidden="true"></code-icon>
								<span
									>This regular expression isn't valid, so this remote is ignored until it's
									fixed.</span
								>
							</p>`
						: nothing
				}
				${
					serverStyleDomain
						? html`<p class="notice notice--hint">
								<code-icon icon="info" aria-hidden="true"></code-icon>
								<span
									>Self-hosted ${typeLabel} URLs are usually path-based — a plain domain may not
									match. Consider a regex that captures the domain and path.</span
								>
							</p>`
						: nothing
				}
			</div>

			<div class="subfields">
				<div class="field">
					<label class="field__label" for="remote-${index}-name">Name (optional)</label>
					<input
						id="remote-${index}-name"
						type="text"
						spellcheck="false"
						placeholder="My Git host"
						.value=${draft.name ?? ''}
						@blur=${(e: FocusEvent) =>
							this.commit({ name: (e.target as HTMLInputElement).value || undefined })}
					/>
				</div>
				<div class="field">
					<label class="field__label" for="remote-${index}-protocol">Protocol (optional)</label>
					<input
						id="remote-${index}-protocol"
						type="text"
						spellcheck="false"
						placeholder="https"
						.value=${draft.protocol ?? ''}
						@blur=${(e: FocusEvent) =>
							this.commit({ protocol: (e.target as HTMLInputElement).value || undefined })}
					/>
				</div>
			</div>

			<gl-checkbox
				.checked=${draft.ignoreSSLErrors === true || draft.ignoreSSLErrors === 'force'}
				@gl-change-value=${(e: Event) =>
					this.commit({
						ignoreSSLErrors: (e.target as HTMLElement & { checked: boolean }).checked ? true : undefined,
					})}
				>Ignore SSL certificate errors</gl-checkbox
			>

			${isCustom ? this.renderUrls(draft, index, urlsIncomplete) : nothing}
		</div>`;
	}

	private renderUrls(draft: RemoteDraft, index: number, incomplete: boolean) {
		return html`<div class="urls">
			<span class="urls__heading">URL templates</span>
			${
				incomplete
					? html`<p class="notice notice--warning">
							<code-icon icon="warning" aria-hidden="true"></code-icon>
							<span
								>Fill in every required URL template so this custom remote can resolve links — it isn't
								saved until they're complete.</span
							>
						</p>`
					: nothing
			}
			${urlFields.map(f => {
				const value = (draft.urls as Record<string, string> | undefined)?.[f.key] ?? '';
				const invalid = f.required && incomplete && !value.trim();
				return html`<div class="field">
					<label class="field__label" for="remote-${index}-url-${f.key}"
						>${f.label}${f.required ? '' : ' (optional)'}</label
					>
					<input
						id="remote-${index}-url-${f.key}"
						class="${invalid ? 'invalid' : ''}"
						type="text"
						spellcheck="false"
						.value=${value}
						@blur=${(e: FocusEvent) => this.commitUrl(f.key, (e.target as HTMLInputElement).value)}
					/>
					<span class="field__tokens">Tokens: ${f.tokens.map(t => html`<code>${t}</code> `)}</span>
				</div>`;
			})}
		</div>`;
	}

	override render(): unknown {
		const remotes = this.remotes;
		const draftIndex = this._draftIndex;

		// For an open persisted row the summary renders from the persisted `entry` (the
		// source of truth for what's live) while only the editor body renders the staged
		// `_draft` — so an invalid in-progress edit can't misreport what's actually live.
		const rows = remotes.map((entry, i) =>
			this._draft != null && draftIndex === i
				? html`<div class="rule" data-index=${i}>
						${this.renderSummary(entry, i, true)}${this.renderEditor(this._draft, i)}
					</div>`
				: html`<div class="rule" data-index=${i}>${this.renderSummary(entry, i, false)}</div>`,
		);

		// A not-yet-persisted new row has no config entry — append it
		if (this._draftIsNew && this._draft != null && draftIndex != null && draftIndex >= remotes.length) {
			rows.push(
				html`<div class="rule" data-index=${draftIndex}>
					${this.renderSummary(this._draft, draftIndex, true)}${this.renderEditor(this._draft, draftIndex)}
				</div>`,
			);
		}

		return html`${
				this._externalNotice
					? html`<p class="notice notice--hint">
							<code-icon icon="info" aria-hidden="true"></code-icon>
							<span>${this._externalNotice}</span>
						</p>`
					: nothing
			}
			<div class="rules">${rows}</div>
			<p class="hint">
				Match your Git remotes to a provider so GitLens can open files, commits, branches, and pull requests on
				the right host — including self-hosted GitHub, GitLab, and Bitbucket Server. Use a domain to match a
				known provider, or a regex for advanced matching.
			</p>
			<gl-button appearance="secondary" @click=${this.addDraftRule}>
				<code-icon icon="add" slot="prefix" aria-hidden="true"></code-icon> Add remote
			</gl-button>`;
	}
}

/** True once `pattern` compiles the way the consumer builds it (`new RegExp(pattern, 'i')`, `matcher.ts:128`). */
function regexCompiles(pattern: string): boolean {
	try {
		new RegExp(pattern, 'i');
		return true;
	} catch {
		return false;
	}
}
