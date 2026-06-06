import type { GlPlusCommands, GlWebviewCommands } from '../constants.commands.js';
import type { WebviewIds } from '../constants.views.js';

export function createWebviewCommandLink<T>(
	command: GlWebviewCommands | GlPlusCommands,
	webviewId: WebviewIds,
	webviewInstanceId: string | undefined,
	args?: T,
): string {
	return `command:${command}?${encodeURIComponent(
		JSON.stringify({ webview: webviewId, webviewInstance: webviewInstanceId, ...args } satisfies WebviewContext),
	)}`;
}

export interface WebviewContext {
	webview: WebviewIds;
	webviewInstance: string | undefined;
}

export function isWebviewContext(item: object | null | undefined): item is WebviewContext {
	if (item == null) return false;

	return 'webview' in item && item.webview != null;
}

export interface WebviewItemContext<TValue = unknown> extends Partial<WebviewContext> {
	webviewItem: string;
	webviewItemValue: TValue;
	/** Merged (least-common-denominator) `webviewItem` across a multi-selection — drives `.multi` menu `when` gating. */
	webviewItems?: string;
	/** Union of `+flag` additions across a multi-selection — drives `.multi` `when` for ops that apply to ANY selected item (Stage/Unstage/Discard), not only when every item qualifies. */
	webviewItemsUnion?: string;
	webviewItemsValues?: { webviewItem: string; webviewItemValue: TValue }[];
	/** True when this row is part of an active multi-selection (>1). Pairs with {@link webviewItems}/{@link webviewItemsValues}. */
	listMultiSelection?: boolean;
}

export function isWebviewItemContext<TValue = unknown>(
	item: object | null | undefined,
): item is WebviewItemContext<TValue> & WebviewContext {
	if (item == null) return false;

	return 'webview' in item && item.webview != null && 'webviewItem' in item;
}

export interface WebviewItemGroupContext<TValue = unknown> extends Partial<WebviewContext> {
	webviewItemGroup: string;
	webviewItemGroupValue: TValue;
}

export function isWebviewItemGroupContext<TValue = unknown>(
	item: object | null | undefined,
): item is WebviewItemGroupContext<TValue> & WebviewContext {
	if (item == null) return false;

	return 'webview' in item && item.webview != null && 'webviewItemGroup' in item;
}

export function serializeWebviewItemContext<T = WebviewItemContext | WebviewItemGroupContext>(context: T): string {
	return JSON.stringify(context);
}

/**
 * Returns a copy of `context` with `+<flag>` appended to its `webviewItem` string. Used for
 * conditionally-applied flags like `+working` whose state isn't known at the time the host
 * builds the base context (e.g. async `hasChanges` resolution for worktrees). No-op if the
 * flag is already present so repeated applications are idempotent.
 */
export function withWebviewItemFlag<T extends WebviewItemContext>(context: T, flag: string): T {
	const re = new RegExp(`\\+${flag}\\b`);
	if (re.test(context.webviewItem)) return context;
	return { ...context, webviewItem: `${context.webviewItem}+${flag}` };
}

/**
 * Boils a multi-selection's `webviewItem` strings down to a least-common-denominator `webviewItems`
 * string for `.multi` menu `when` gating: the shared base type plus only the `+flags` present on
 * EVERY item (`gitlens:file+staged` ×N → `gitlens:file+staged`; mixed staged/unstaged →
 * `gitlens:file`). Returns `undefined` when the items don't share a base type. Mirrors the graph's
 * selection boil-down so both surfaces gate identically.
 */
export function mergeWebviewItems(items: readonly string[]): string | undefined {
	if (items.length === 0) return undefined;
	if (items.length === 1) return items[0];

	const split = items.map(item => {
		const parts = item.split('+');
		return { baseType: parts[0], additions: parts.slice(1) };
	});

	const baseType = split[0].baseType;
	if (!split.every(s => s.baseType === baseType)) return undefined;

	// Keep only additions present on every item (dedupe within an item first).
	const frequency = new Map<string, number>();
	for (const s of split) {
		for (const addition of new Set(s.additions)) {
			frequency.set(addition, (frequency.get(addition) ?? 0) + 1);
		}
	}
	const common: string[] = [];
	for (const [addition, count] of frequency) {
		if (count === items.length) {
			common.push(addition);
		}
	}

	return common.length > 0 ? `${baseType}+${common.join('+')}` : baseType;
}

/**
 * Like {@link mergeWebviewItems} but UNIONs the `+flag` additions instead of intersecting them — for
 * `.multi` commands that should appear when the operation applies to ANY selected item (e.g. Stage
 * shows if any file is unstaged, even in a mixed staged/unstaged selection), not only when every item
 * qualifies. Returns `undefined` when the items don't share a base type (same as the intersection).
 */
export function mergeWebviewItemsUnion(items: readonly string[]): string | undefined {
	if (items.length === 0) return undefined;
	if (items.length === 1) return items[0];

	const split = items.map(item => {
		const parts = item.split('+');
		return { baseType: parts[0], additions: parts.slice(1) };
	});

	const baseType = split[0].baseType;
	if (!split.every(s => s.baseType === baseType)) return undefined;

	const all = new Set<string>();
	for (const s of split) {
		for (const addition of s.additions) {
			all.add(addition);
		}
	}

	return all.size > 0 ? `${baseType}+${[...all].join('+')}` : baseType;
}
