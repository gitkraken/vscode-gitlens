import type SlSelect from '@shoelace-style/shoelace/dist/components/select/select.js';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { RebaseTodoCommitAction, UpdateRefInfo } from '../../../../git/models/rebase';
import { commitRebaseActions } from '../../../../git/utils/rebase.utils';
import type { Author, RebaseEntry } from '../../../rebase/protocol';
import { isCommitEntry } from '../../../rebase/protocol';
import type { AvatarShape } from '../../shared/components/avatar/avatar-list';
import { entryStyles } from './rebase-entry.css';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '../../shared/components/avatar/avatar-list';
import '../../shared/components/chips/ref-overflow-chip';
import '../../shared/components/overlays/tooltip';

const allCommitActions = [...commitRebaseActions.values()];
const oldestCommitActions = allCommitActions.filter(a => a !== 'squash' && a !== 'fixup');

/** Icons for command entry types */
const commandIcons: Record<string, string> = {
	break: 'debug-pause',
	exec: 'terminal',
	noop: 'circle-slash',
};

/** Descriptions for non-exec command types */
const commandDescriptions: Record<string, string> = {
	break: 'Will pause the rebase here',
	exec: 'Will run',
	noop: 'No operation',
};

/**
 * Single rebase entry component - optimized for virtualization.
 *
 * Design principles:
 * - Lightweight: minimal DOM, no complex state
 * - Recyclable: properties update efficiently for virtualizer reuse
 * - Event delegation: emits events for parent to handle
 */
@customElement('gl-rebase-entry')
export class GlRebaseEntryElement extends LitElement {
	static override styles = [entryStyles];

	@query('.action-select') private readonly _actionSelect!: SlSelect;

	@property({
		type: Object,
		// Custom hasChanged to detect changes even if same object reference
		hasChanged: (newVal: RebaseEntry | undefined, oldVal: RebaseEntry | undefined) => {
			if (newVal === oldVal) return false;
			if (!newVal || !oldVal) return true;

			// Trigger update if entry ID, action, or commit data changed (important for virtualizer recycling)
			if (newVal.id !== oldVal.id || newVal.action !== oldVal.action || newVal.commit !== oldVal.commit) {
				return true;
			}
			return false;
		},
	})
	entry!: RebaseEntry;
	@property({ type: Object }) authors?: Record<string, Author>;
	@property({ type: String }) revealLocation: 'graph' | 'inspect' = 'graph';
	@property({ type: Boolean, reflect: true }) isBase = false;
	@property({ type: Boolean, reflect: true }) isCurrent = false;
	@property({ type: Boolean, reflect: true }) isDone = false;
	@property({ type: Boolean }) isSquashTarget = false;
	@property({ type: Boolean }) isOldest = false;
	@property({ type: Boolean }) isFirst = false;
	@property({ type: Boolean }) isLast = false;
	@property({ type: Boolean }) isSelected = false;
	@property({ type: Boolean }) isSquashing = false;

	override connectedCallback(): void {
		super.connectedCallback?.();
		// Base and done entries are not draggable
		if (!this.isBase && !this.isDone) {
			this.setAttribute('draggable', 'true');
		}
	}

	private get availableActions(): RebaseTodoCommitAction[] {
		// Oldest commit can't squash/fixup (nothing to squash into)
		return this.isOldest ? oldestCommitActions : allCommitActions;
	}

	// Use arrow function to preserve `this` binding when virtualizer recycles elements
	private onActionChanged = (e: Event) => {
		if (!isCommitEntry(this.entry)) return;

		const select = e.target as SlSelect;
		const action = select.value as RebaseTodoCommitAction;
		this.dispatchEvent(
			new CustomEvent('action-changed', {
				detail: { sha: this.entry.sha, action: action },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private onClick = (e: MouseEvent) => {
		// Don't trigger on interactive elements (they handle their own clicks)
		const target = e.target as HTMLElement;
		if (target.closest('sl-select, a, button')) return;

		this.dispatchEvent(
			new CustomEvent('entry-select', {
				detail: {
					id: this.entry.id,
					sha: isCommitEntry(this.entry) ? this.entry.sha : undefined,
					ctrlKey: e.ctrlKey || e.metaKey,
					shiftKey: e.shiftKey,
				},
				bubbles: true,
				composed: true,
			}),
		);
	};

	private onDoubleClick = (e: MouseEvent) => {
		if (!isCommitEntry(this.entry)) return;

		// Don't trigger on interactive elements
		const target = e.target as HTMLElement;
		if (target.closest('sl-select, a, button')) return;

		// Dispatch reveal event for the commit
		this.dispatchRevealCommit();
	};

	private onShaClick = (e: MouseEvent) => {
		e.preventDefault();
		if (!isCommitEntry(this.entry)) return;
		this.dispatchRevealCommit();
	};

	private dispatchRevealCommit() {
		if (!isCommitEntry(this.entry)) return;
		this.dispatchEvent(
			new CustomEvent('gl-reveal-commit', {
				detail: { sha: this.entry.sha },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render() {
		// Render command entries (exec, break, noop)
		if (!isCommitEntry(this.entry)) {
			return this.renderCommandEntry();
		}

		// Render commit entries
		return this.renderCommitEntry();
	}

	private renderCommitEntry() {
		if (!isCommitEntry(this.entry)) return nothing;

		const {
			authors,
			entry: { action, commit, message: entryMessage, updateRefs, sha },
			isBase,
			isCurrent,
			isDone,
		} = this;

		// Emit event for missing commit data so parent can fetch it
		if (!commit) {
			this.emitMissingCommit(sha);
		}

		const author = commit && authors?.[commit.author];
		const committer = commit && authors?.[commit.committer];
		const message = commit?.message ?? entryMessage;

		// Determine the type for data attribute
		let type = 'commit';
		if (isBase) {
			type = 'base';
		} else if (isDone) {
			type = 'done';
		}

		const ariaLabel = `${action}, ${message}, ${sha.substring(0, 7)}`;

		return html`
			<div
				role="listitem"
				aria-label=${ariaLabel}
				class=${classMap({
					entry: true,
					'entry--first': this.isFirst,
					'entry--last': this.isLast,
					'entry--selected': !isBase && !isDone && this.isSelected,
					'entry--done': isDone,
					'entry--current': isCurrent,
				})}
				data-type="${type}"
				data-action=${action}
				data-squashing=${ifDefined(this.isSquashing ? true : undefined)}
				data-squash-target=${ifDefined(this.isSquashTarget ? true : undefined)}
				tabindex="0"
				@click=${this.onClick}
				@dblclick=${this.onDoubleClick}
			>
				<span class="entry-graph" aria-hidden="true"></span>

				${!isBase
					? html`<div class="entry-action">
							<sl-select
								class="action-select"
								value=${action}
								@sl-change=${this.onActionChanged}
								?disabled=${isDone}
								hoist
							>
								<code-icon icon="chevron-down" slot="expand-icon"></code-icon>
								${this.availableActions.map(
									action => html`<sl-option value=${action}>${action}</sl-option>`,
								)}
							</sl-select>
						</div>`
					: nothing}

				<gl-tooltip class="entry-message" hoist hide-on-click placement="bottom-start" .content=${message}>
					<span class="entry-message-content">${message}</span>
				</gl-tooltip>

				${!isBase && updateRefs?.length ? this.renderUpdateRefBadges(updateRefs) : nothing}
				${this.renderAvatar(author, committer)}
				${commit?.formattedDate
					? html`<gl-tooltip class="entry-date" hoist hide-on-click .content=${commit.date ?? ''}>
							<span class="entry-date-content">${commit.formattedDate}</span>
						</gl-tooltip>`
					: nothing}

				<gl-tooltip
					class="entry-sha"
					hoist
					hide-on-click
					content=${this.revealLocation === 'graph' ? 'Open in Commit Graph' : 'Open in Inspect View'}
				>
					<a href="#" class="entry-sha-link" @click=${this.onShaClick}>
						<code-icon icon="git-commit"></code-icon>
						<span class="entry-sha-content">${sha.substring(0, 7)}</span>
					</a>
				</gl-tooltip>
			</div>
		`;
	}

	private renderCommandEntry() {
		if (this.entry.type !== 'command') return nothing;

		const { action, command } = this.entry;
		const icon = commandIcons[action] ?? 'circle-outline';
		const description = commandDescriptions[action];

		const ariaLabel = command ? `${action} ${command}` : action;

		return html`
			<div
				role="listitem"
				aria-label=${ariaLabel}
				class=${classMap({
					entry: true,
					'entry--first': this.isFirst,
					'entry--last': this.isLast,
					'entry--selected': this.isSelected,
				})}
				tabindex="0"
				data-type="command"
				data-action=${action}
				data-squashing=${ifDefined(this.isSquashing ? true : undefined)}
				@click=${this.onClick}
			>
				<span class="entry-graph" aria-hidden="true">
					<code-icon icon=${icon}></code-icon>
				</span>

				<div class="entry-action">
					<sl-select class="action-select" value=${action} disabled>
						<sl-option value=${action}>${action}</sl-option>
					</sl-select>
				</div>

				${action === 'exec' && command
					? html`<gl-tooltip
							class="entry-message"
							hoist
							hide-on-click
							placement="bottom-start"
							.content=${command}
							><span class="entry-message-content"
								>${description} <code>${command}</code></span
							></gl-tooltip
						>`
					: description
						? html`<span class="entry-message"
								><span class="entry-message-content">${description}</span></span
							>`
						: nothing}
			</div>
		`;
	}

	private renderUpdateRefBadges(refs: UpdateRefInfo[]) {
		const refItems = refs.map(r => ({ name: r.ref }));
		return html`<gl-ref-overflow-chip
			class="entry-update-refs"
			.refs=${refItems}
			icon="git-branch"
			label="Branches to update"
		></gl-ref-overflow-chip>`;
	}

	private renderAvatar(author: Author | undefined, committer: Author | undefined) {
		if (!author) return nothing;

		// Emit event for missing avatars so parent can fetch them
		if (!author.avatarUrl && author.email) {
			this.emitMissingAvatar(author.email);
		}

		const avatars: AvatarShape[] = [
			{
				name: committer?.author !== author.author ? `${author.author} (Author)` : author.author,
				src: author.avatarUrl ?? author.avatarFallbackUrl,
			},
		];

		if (committer && committer.author !== author.author) {
			// Emit event for missing avatars so parent can fetch them
			if (!committer.avatarUrl && committer.email) {
				this.emitMissingAvatar(committer.email);
			}

			avatars.push({
				name: `${committer.author} (Committer)`,
				src: committer.avatarUrl ?? committer.avatarFallbackUrl,
			});
		}

		return html`<gl-avatar-list class="entry-avatar" .avatars=${avatars} max="2"></gl-avatar-list>`;
	}

	private emitMissingAvatar(email: string) {
		if (!isCommitEntry(this.entry)) return;

		this.dispatchEvent(
			new CustomEvent('missing-avatar', {
				detail: { email: email, sha: this.entry.sha },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private emitMissingCommit(sha: string) {
		this.dispatchEvent(new CustomEvent('missing-commit', { detail: { sha: sha }, bubbles: true, composed: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-rebase-entry': GlRebaseEntryElement;
	}
}
