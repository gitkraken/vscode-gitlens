import type { Uri } from 'vscode';
import type { GitGraphRow, GitGraphRowContexts, GraphContext, GraphRowProcessor } from '@gitlens/git/models/graph.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import { computeGraphRowContextFlags } from '@gitlens/git/utils/reachability.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { getCachedAvatarUri } from '../avatars.js';
import type { Container } from '../container.js';
import { emojify } from '../emojis.js';
import { serializeWebviewItemContext } from '../system/webview.js';
import type { GraphItemRefContext, GraphItemRefGroupContext } from '../webviews/plus/graph/protocol.js';
import { formatCurrentUserDisplayName } from './utils/-webview/commit.utils.js';
import { getRemoteIconUri } from './utils/-webview/icons.js';

export class GlGraphRowProcessor implements GraphRowProcessor {
	constructor(
		private readonly container: Container,
		private readonly asWebviewUri: (uri: Uri) => Uri,
	) {}

	processRow(row: GitGraphRow, context: GraphContext): void {
		// Build contexts object for this row
		const contexts: GitGraphRowContexts = {};

		// Build ref group contexts from grouped local + remote refs
		const refGroups = this.buildRefGroupContexts(row, context);
		if (refGroups != null) {
			contexts.refGroups = refGroups;
		}

		// Build row context (stash or commit) and avatar context
		if (row.kind === 'stash') {
			const stashRow = this.buildStashRowContext(row, context);
			if (stashRow != null) {
				contexts.row = stashRow;
			}
		} else {
			// Commit `contexts.row` + `contexts.avatar` are NOT serialized here: they duplicated
			// sha/message/repoPath/author/email already present on the row, a meaningful chunk of the
			// per-row payload. Instead ship the two host-only bits as compact flags; the webview
			// reconstructs the full webview-item contexts on demand at right-click/selection time from
			// row fields + repoPath + these flags (see `rowContext.utils` + `graph-wrapper`'s
			// `injectRowContextMenuContext`). `+HEAD`/`+worktreeHEAD` and contributor `+current` are
			// derived webview-side from `row.heads`/`row.isCurrentUser` and need no flag.
			contexts.flags = computeGraphRowContextFlags(row.sha, row.reachability?.refs, context);

			// Populate avatar cache
			if (!context.avatars.has(row.email)) {
				const avatarUri = getCachedAvatarUri(row.email);
				if (avatarUri != null) {
					context.avatars.set(row.email, avatarUri.toString(true));
				}
			}
		}

		row.contexts = contexts;

		// Apply display name formatting for current user (after context building, which uses the raw name)
		if (row.isCurrentUser) {
			row.author = formatCurrentUserDisplayName(row.author);
		}

		// Emojify message (after context building, which uses the raw message)
		row.message = emojify(row.message);
	}

	/**
	 * Re-stamps a reused row's `repoPath`-derived decorations for a session rebind: rebuilds the serialized
	 * `refGroups`/stash `row` contexts so their embedded `repoPath` matches `context.repoPath`.
	 *
	 * Deliberately never touches `message`/`author` — emojify and author display-name formatting are not
	 * idempotent — nor the commit-row `flags`/avatar-cache population, neither of which is `repoPath`-derived.
	 */
	restampRow(row: GitGraphRow, context: GraphContext): void {
		// Cheap bail-out — the overwhelming majority of rows carry no repoPath-derived decorations.
		if (row.contexts?.refGroups == null && row.contexts?.row == null) return;

		// The row's ref ids are already re-stamped by the time this runs — the provider owns them
		// (`restampGraphRowIds`, called from the walk itself, the only layer guaranteed to run; this
		// processor is optional). So this rebuilds ONLY the host-serialized contexts, which embed the
		// repoPath in a form the provider can't produce.
		const contexts: GitGraphRowContexts = { ...row.contexts };

		if (row.heads != null || row.remotes != null) {
			const refGroups = this.buildRefGroupContexts(row, context);
			if (refGroups != null) {
				contexts.refGroups = refGroups;
			} else {
				delete contexts.refGroups;
			}
		}

		if (row.kind === 'stash' && row.contexts?.row != null) {
			const stashRow = this.buildStashRowContext(row, context);
			if (stashRow != null) {
				contexts.row = stashRow;
			}
		}

		row.contexts = contexts;
	}

	/**
	 * Builds the serialized ref-GROUP contexts (`contexts.refGroups`) from the row's local + remote heads.
	 * Per-ref contexts are deliberately not built here — the webview builds them from the structured fields,
	 * where it can also see state the host would bake in stale (starred, pinned).
	 *
	 * Also resolves each remote head's `avatarUrl` as a side effect (it needs the container's asset URIs).
	 */
	private buildRefGroupContexts(
		row: GitGraphRow,
		context: GraphContext,
	): Record<string, string | object> | undefined {
		// Lazy — the overwhelming majority of rows carry no refs, and this runs once per row.
		let groupedRefs:
			| Map<string, { head?: boolean; local?: GitBranchReference; remotes?: GitBranchReference[] }>
			| undefined;

		// Collect local heads for the ref-GROUP contexts below.
		if (row.heads) {
			for (const head of row.heads) {
				const branch = context.branches.get(head.name);

				groupedRefs ??= new Map();
				let group = groupedRefs.get(head.name);
				if (group == null) {
					group = {};
					groupedRefs.set(head.name, group);
				}
				if (head.isCurrentHead) {
					group.head = true;
				}
				group.local = createReference(head.name, context.repoPath, {
					id: head.id,
					refType: 'branch',
					name: head.name,
					remote: false,
					upstream: branch?.upstream,
				});
			}
		}

		// Remote heads still need their avatar URL resolved here (it needs the container's asset URIs), and
		// their reference collected for the group context; the per-ref context moved to the webview.
		if (row.remotes) {
			for (const remoteHead of row.remotes) {
				const remote = context.remotes.get(remoteHead.owner);
				const fullName = `${remoteHead.owner}/${remoteHead.name}`;

				// Set avatar URL from provider data or extension icon URI
				remoteHead.avatarUrl = (
					(context.useAvatars ? remote?.provider?.avatarUri : undefined) ??
					(remote != null ? getRemoteIconUri(this.container, remote, this.asWebviewUri) : undefined)
				)?.toString(true);

				groupedRefs ??= new Map();
				let group = groupedRefs.get(remoteHead.name);
				if (group == null) {
					group = { remotes: [] };
					groupedRefs.set(remoteHead.name, group);
				}
				group.remotes ??= [];
				group.remotes.push(
					createReference(fullName, context.repoPath, {
						id: remoteHead.id,
						refType: 'branch',
						name: fullName,
						remote: true,
						upstream: { name: remoteHead.owner, missing: false },
					}),
				);
			}
		}

		if (groupedRefs == null) return undefined;

		let refGroups: Record<string, string | object> | undefined;
		for (const [groupName, group] of groupedRefs) {
			if (
				group.remotes != null &&
				((group.local != null && group.remotes.length > 0) || group.remotes.length > 1)
			) {
				refGroups ??= {};
				refGroups[groupName] = serializeWebviewItemContext<GraphItemRefGroupContext>({
					webviewItemGroup: `gitlens:refGroup${group.head ? '+current' : ''}`,
					webviewItemGroupValue: {
						type: 'refGroup',
						refs: group.local != null ? [group.local, ...group.remotes] : group.remotes,
					},
				});
			}
		}

		return refGroups;
	}

	private buildStashRowContext(row: GitGraphRow, context: GraphContext): string | object | undefined {
		const stash = context.stashes?.get(row.sha);
		if (stash == null) return undefined;

		return serializeWebviewItemContext<GraphItemRefContext>({
			webviewItem: 'gitlens:stash',
			webviewItemValue: {
				type: 'stash',
				ref: createReference(row.sha, context.repoPath, {
					refType: 'stash',
					name: stash.name,
					message: stash.message,
					number: stash.stashNumber,
				}),
			},
		});
	}
}
