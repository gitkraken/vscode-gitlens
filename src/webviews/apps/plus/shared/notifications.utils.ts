import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import type { GkNotification, ProjectSharedDetails } from '@gitlens/notifications/models.js';
import { getCategoryChip, getDisplayBody, toPlainText } from '@gitlens/notifications/presentation.js';

/**
 * Presentation rules shared by every surface that lists GitKraken notifications (the Settings inbox, the Graph
 * header's bell), so a notification reads the same everywhere. Never uses the server's internal `name`.
 */

/** The category chip's label, and whether it warns; `undefined` for a notification without a chip */
export function getCategoryChipBadge(n: GkNotification): { label: string; warning: boolean } | undefined {
	switch (getCategoryChip(n.contentType)) {
		case 'help':
			return { label: l10n.t('Help'), warning: false };
		case 'offer':
			return { label: l10n.t('Offer'), warning: false };
		case 'security':
			return { label: l10n.t('Security'), warning: true };
		case 'system':
			return { label: l10n.t('System'), warning: true };
		default:
			return undefined;
	}
}

/**
 * Who a notification is from, for the byline a card without a {@link getNotificationHeadline heading} shows, and its
 * accessible name when there's no body either. A product name, so it isn't localized.
 */
export function getNotificationSender(): string {
	return 'GitKraken';
}

/** The note a notification shown through its fallback text gets (see `GkNotification.needsNewerVersion`) */
export function getNeedsNewerVersionText(): string {
	return l10n.t('This notification needs a newer version of GitLens.');
}

/** The server's title, else its one-line summary; `undefined` when it has neither */
export function getNotificationHeaderText(n: GkNotification): string | undefined {
	return n.headline ?? n.summary;
}

/**
 * The notification's heading: its {@link getNotificationHeaderText header text}, else a Team Workspace share names
 * itself. Anything else gets no heading at all (a synthetic "GitKraken" heading says nothing), and the surface shows
 * a sender byline instead.
 */
export function getNotificationHeadline(n: GkNotification): string | undefined {
	return getNotificationHeaderText(n) ?? (n.event === 'projectShared' ? l10n.t('Team Workspace shared') : undefined);
}

/**
 * The body sentence a Team Workspace share gets (it has no server body), with `project` placed into it: the plain name
 * gives the sentence as text, markup gives the parts to render.
 */
export function formatProjectSharedBody(shared: ProjectSharedDetails, project: string): string;
export function formatProjectSharedBody(shared: ProjectSharedDetails, project: TemplateResult): unknown[];
export function formatProjectSharedBody(
	shared: ProjectSharedDetails,
	project: string | TemplateResult,
): string | unknown[] {
	const parts = shared.teams.length
		? localizedContent(l10n.t('In {organization}, {owner} created a new Team Workspace: {project} with {teams}'), {
				organization: shared.organization,
				owner: shared.owner,
				project: project,
				teams: new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }).format(shared.teams),
			})
		: localizedContent(l10n.t('In {organization}, {owner} created a new Team Workspace: {project}'), {
				organization: shared.organization,
				owner: shared.owner,
				project: project,
			});
	return typeof project === 'string' ? parts.join('') : parts;
}

/**
 * The notification's body as one line of plain text, for surfaces that can't render markdown: the Team Workspace
 * sentence, else the display body (without a first paragraph that only repeats the header). Falls back to the
 * needs-a-newer-version note when there's no body; `undefined` when there's nothing to show.
 */
export function getNotificationBodyText(n: GkNotification): string | undefined {
	const shared = n.projectShared;
	if (n.event === 'projectShared' && shared != null) {
		return formatProjectSharedBody(shared, shared.project);
	}

	const markdown = getDisplayBody(getNotificationHeaderText(n), n.body);
	const text = markdown != null ? toPlainText(markdown) : undefined;
	if (text) return text;

	return n.needsNewerVersion ? getNeedsNewerVersionText() : undefined;
}

/** Whether an element's text is cut off, by an ellipsis (width) or a line clamp (height) */
export function isTextTruncated(
	el: Pick<HTMLElement, 'clientHeight' | 'clientWidth' | 'scrollHeight' | 'scrollWidth'>,
): boolean {
	return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/**
 * Enables the headline tooltip (a `gl-tooltip` wrapping each matched element, rendered `disabled`) only where the
 * headline is actually truncated, so a headline that fits doesn't repeat itself in a tooltip. Call after a render,
 * and again when the layout changes.
 */
export function syncTruncationTooltips(root: ParentNode, selector: string): void {
	for (const el of root.querySelectorAll<HTMLElement>(selector)) {
		const tooltip = el.closest<HTMLElement & { disabled: boolean }>('gl-tooltip');
		if (tooltip != null) {
			tooltip.disabled = !isTextTruncated(el);
		}
	}
}

/**
 * Keeps `observer` watching exactly the elements under `root` that match `selector`: new matches are observed and
 * ones no longer rendered are released (`observed` is the caller's record of them). A headline's box changes when
 * the content beside it finishes rendering, which a host- or panel-level observer can't see.
 */
export function observeTruncationTargets(
	observer: ResizeObserver,
	root: ParentNode,
	selector: string,
	observed: Set<Element>,
): void {
	const current = new Set(root.querySelectorAll(selector));
	for (const el of observed) {
		if (!current.has(el)) {
			observer.unobserve(el);
			observed.delete(el);
		}
	}
	for (const el of current) {
		if (!observed.has(el)) {
			observer.observe(el);
			observed.add(el);
		}
	}
}
