/**
 * Declarative model for the Settings webview.
 *
 * Every editable setting is one descriptor; the renderer dispatches on `kind`.
 * Descriptor `key`s are typed config paths so config refactors fail compilation
 * here instead of silently orphaning a control.
 *
 * Visibility/enablement use the legacy state-expression grammar so the existing
 * (verified) semantics port 1:1: terms AND-ed with `&`; each term is
 * `path` (truthy), `path=value`, `path!value` (not equals), or `path+value`
 * (array contains). There is no OR, no parentheses, no escaping.
 */
import type { GlExtensionCommands } from '../../../constants.commands.js';
import type { ConfigPath } from '../../../system/-webview/configuration.js';
import type { CustomConfigPath } from '../../protocol.js';

export type SettingsKey = ConfigPath | CustomConfigPath;

export type SettingsGroup = 'Annotations' | 'In-editor' | 'Views' | 'Integrations' | 'Editing' | 'General';

export type PreviewKind =
	| 'blame'
	| 'codelens'
	| 'statusbar'
	| 'fileblame'
	| 'filechanges'
	| 'heatmap'
	| 'graph'
	| 'hover';

export interface SelectOptionDescriptor {
	value: string;
	label: string;
}

export interface CheckGroupOptionDescriptor {
	value: string;
	label: string;
	hint?: string;
}

interface DescriptorBase {
	label: string;
	/** Secondary text rendered under the control */
	hint?: string;
	/** Legacy state expression controlling whether the control is interactive */
	enabledWhen?: string;
	/** Legacy state expression controlling whether the control is rendered */
	visibleWhen?: string;
	/** Render indented under the preceding control */
	indent?: boolean;
}

/**
 * Boolean-ish checkbox.
 *
 * `type` mirrors the legacy `data-setting-type` semantics:
 * - undefined — plain boolean setting
 * - 'custom' — virtual setting computed host-side (`customSettings`)
 * - 'object' — `key` is the object-valued setting; `path` is the nested
 *   property to set; the whole object is written on change
 * - 'array' — `key` is a string-array setting; `value` is the member this
 *   checkbox controls (prefer `checkgroup` for new UI; this exists for
 *   stand-alone members)
 */
export interface CheckDescriptor extends DescriptorBase {
	kind: 'check';
	key: SettingsKey;
	type?: 'custom' | 'object' | 'array';
	/** For type 'object': the nested property path within the object value */
	path?: string;
	/** For type 'array': the member value this checkbox toggles */
	value?: string;
	/** Value written when checked (legacy checkbox `value` through `fromCheckboxValue`); defaults to `true` */
	valueOn?: string | boolean | null;
	/**
	 * Checked clears the override instead of writing a value (legacy checkbox
	 * `value="undefined"` — e.g. `menus`, where removal restores the defaults)
	 */
	checkedRemoves?: boolean;
	/** Value written when unchecked (legacy `data-value-off`); a current value of `null` renders indeterminate */
	valueOff?: string | false | null;
	/** Additional `key=value` writes applied when checked (legacy `data-add-settings-on`) */
	addSettingsOn?: [SettingsKey, string | boolean | null][];
	/** Additional `key=value` writes applied when unchecked (legacy `data-add-settings-off`) */
	addSettingsOff?: [SettingsKey, string | boolean | null][];
}

export interface SelectDescriptor extends DescriptorBase {
	kind: 'select';
	key: SettingsKey;
	options: SelectOptionDescriptor[];
}

/** Mutually-exclusive 2–4 choice control; value semantics identical to a select. */
export interface SegmentedDescriptor extends DescriptorBase {
	kind: 'segmented';
	key: SettingsKey;
	options: SelectOptionDescriptor[];
}

export interface FormatPreviewDescriptor {
	/**
	 * How the live example is produced:
	 * - 'commit' / 'commit-uncommitted' — host RPC renders the real `CommitFormatter`
	 * - 'date' — app-side `formatDate` against the fixed sample date
	 * - 'date-locale' — value is a locale; format read from `defaultLookup`
	 */
	type: 'commit' | 'commit-uncommitted' | 'date' | 'date-locale';
	/** Literal fallback format when the input is empty */
	default?: string;
	/** Config key to read the fallback format from when the input is empty */
	defaultLookup?: SettingsKey;
}

export interface TextDescriptor extends DescriptorBase {
	kind: 'text';
	key: SettingsKey;
	placeholder?: string;
	/** Value written when the input is emptied (legacy `data-default-value`); omitted means `null` */
	defaultValue?: string;
	/** Live example line configuration */
	preview?: FormatPreviewDescriptor;
	/** Offer the ${token} insert popover */
	tokens?: boolean;
}

export interface NumberDescriptor extends DescriptorBase {
	kind: 'number';
	key: SettingsKey;
	placeholder?: string;
	defaultValue?: string;
}

export interface SliderDescriptor extends DescriptorBase {
	kind: 'slider';
	key: SettingsKey;
	min: number;
	max: number;
	step: number;
	/** Display suffix, e.g. 'px' or ' days' */
	unit?: string;
}

/** A group of checkboxes controlling membership in one string-array setting. */
export interface CheckGroupDescriptor extends DescriptorBase {
	kind: 'checkgroup';
	key: SettingsKey;
	options: CheckGroupOptionDescriptor[];
}

/** The autolinks custom-rules editor + cloud-integration banner (fully dynamic). */
export interface AutolinksDescriptor extends DescriptorBase {
	kind: 'autolinks';
}

/**
 * The cloud-integrations connection panel (fully dynamic — driven by the shared
 * integrations/subscription RPC services, not config). `label`/`hint` exist for search.
 */
export interface IntegrationsPanelDescriptor extends DescriptorBase {
	kind: 'integrations';
}

/**
 * The AI integrations panel — provider/model, GitKraken MCP, default coding
 * agent, and Claude Code hooks rows (driven by the shared AI RPC service; the
 * rows act through commands rather than config writes).
 */
export interface AIPanelDescriptor extends DescriptorBase {
	kind: 'ai';
}

/** Non-interactive informational callout. */
export interface InfoDescriptor {
	kind: 'info';
	text: string;
	visibleWhen?: string;
}

export type SettingDescriptor =
	| CheckDescriptor
	| SelectDescriptor
	| SegmentedDescriptor
	| TextDescriptor
	| NumberDescriptor
	| SliderDescriptor
	| CheckGroupDescriptor
	| AutolinksDescriptor
	| IntegrationsPanelDescriptor
	| AIPanelDescriptor
	| InfoDescriptor;

export interface SettingsCategory {
	/**
	 * Stable id — doubles as the deep-link anchor, so existing
	 * `gitlens.showSettingsPage!<anchor>` commands keep working.
	 */
	id: string;
	name: string;
	group: SettingsGroup;
	/** codicon name, or glicon name prefixed with `gl-` */
	icon: string;
	hint: string;
	pro?: boolean;
	/** Master on/off switch rendered in the category header */
	master?: CheckDescriptor;
	/** "Tip — run <command> …" line under the header */
	command?: { label: string; command: GlExtensionCommands };
	/**
	 * Search term for the "For more options, open the Settings UI…" footer
	 * (legacy footer copy, e.g. 'gitlens.views.commits or gitlens.views');
	 * defaults to the first segment of the category's first setting key
	 */
	settingsSearch?: string;
	learnMoreUrl?: string;
	preview?: PreviewKind;
	controls: SettingDescriptor[];
}

// ============================================================
// State expressions (ported verbatim from the legacy app)
// ============================================================

/** Resolves a setting path to its current value — customSettings first, then nested config. */
export type SettingValueResolver = <T>(path: string) => T | undefined;

function parseStateExpression(expression: string): [string, string, string | undefined] {
	// Split keeps the operator; rejoin everything after it so an rhs containing `=`/`+`/`!` survives
	const [lhs, op, ...rest] = expression.trim().split(/([=+!])/);
	return [lhs.trim(), op !== undefined ? op.trim() : '=', rest.length ? rest.join('').trim() : undefined];
}

/**
 * Evaluates a legacy state expression: `&`-separated AND terms with short-circuit.
 * `=`/`!` compare `String(value)` to the rhs (bare lhs = truthiness); `+` tests
 * string-array membership (always resolved via `getValue` — arrays are invisible
 * to flattened state).
 */
export function evaluateStateExpression(expression: string, getValue: SettingValueResolver): boolean {
	let state = false;
	for (const expr of expression.trim().split('&')) {
		const [lhs, op, rhs] = parseStateExpression(expr);

		switch (op) {
			case '=': {
				let value: string | boolean | null | undefined = getValue<string | boolean>(lhs);
				if (value === undefined || (value === null && typeof rhs !== 'string')) {
					value = false;
				}
				state = rhs !== undefined ? rhs === String(value) : Boolean(value);
				break;
			}
			case '!': {
				let value: string | boolean | null | undefined = getValue<string | boolean>(lhs);
				if (value === undefined || (value === null && typeof rhs !== 'string')) {
					value = false;
				}
				state = rhs !== undefined ? rhs !== String(value) : !value;
				break;
			}
			case '+': {
				if (rhs !== undefined) {
					const setting = getValue<string[]>(lhs);
					state = setting !== undefined ? setting.includes(rhs) : false;
				}
				break;
			}
		}

		if (!state) break;
	}
	return state;
}

// ============================================================
// Object path helpers (ported verbatim from the legacy app)
// ============================================================

export function getPath<T>(o: Record<string, any>, path: string): T | undefined {
	// oxlint-disable-next-line typescript/no-unsafe-return
	return path.split('.').reduce((o = {}, key) => (o == null ? undefined : o[key]), o) as T;
}

export function setPath(o: Record<string, any>, path: string, value: any): Record<string, any> {
	const props = path.split('.');
	const length = props.length;
	const lastIndex = length - 1;

	let index = -1;
	let nested = o;

	while (nested != null && ++index < length) {
		const key = props[index];
		let newValue = value;

		if (index !== lastIndex) {
			const objValue = nested[key];
			newValue = typeof objValue === 'object' ? objValue : {};
		}

		nested[key] = newValue;
		nested = nested[key];
	}

	return o;
}

// ============================================================
// Search
// ============================================================

export interface SettingsSearchMatch {
	category: SettingsCategory;
	/** Keys of the controls (within the category) that matched, empty when only the category matched */
	matchedKeys: string[];
}

export function descriptorKeys(d: SettingDescriptor): string[] {
	switch (d.kind) {
		case 'autolinks':
			return ['autolinks'];
		// The AI panel reflects these settings (read-only or via commands), so a
		// pasted setting name still lands on the category
		case 'ai':
			return ['ai.model', 'ai.defaultAgent', 'gitkraken.mcp.autoEnabled'];
		case 'integrations':
		case 'info':
			return [];
		default:
			return [d.key];
	}
}

function descriptorText(d: SettingDescriptor): string {
	switch (d.kind) {
		case 'info':
			return d.text;
		case 'select':
		case 'segmented':
			return `${d.label} ${d.hint ?? ''} ${d.options.map(o => o.label).join(' ')}`;
		case 'checkgroup':
			return `${d.label} ${d.hint ?? ''} ${d.options.map(o => `${o.label} ${o.hint ?? ''}`).join(' ')}`;
		default:
			return `${d.label} ${d.hint ?? ''}`;
	}
}

/** Reduces markdown-style `[text](target)` links to their text so link targets don't pollute search matching. */
function stripLinks(text: string): string {
	return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * Matches categories and individual settings against a query.
 *
 * Matches on: category name/hint, control labels/hints/option labels, and the
 * LITERAL setting name — `gitlens.currentLine.fontStyle` (the `gitlens.` prefix
 * is optional) — so a key pasted from settings.json lands on its control.
 *
 * When `getValue` is provided, keyless descriptors that are currently hidden
 * (`visibleWhen` false) are excluded — they can't be highlighted or revealed
 * on arrival, so matching their text would land the user on a category with
 * nothing visible to show for it.
 */
export function searchSettings(
	categories: readonly SettingsCategory[],
	query: string,
	getValue?: SettingValueResolver,
): SettingsSearchMatch[] {
	const q = query.trim().toLowerCase();
	if (!q) return categories.map(c => ({ category: c, matchedKeys: [] }));

	// Strip an optional `gitlens.` prefix so literal setting names match their config paths
	const keyQuery = q.startsWith('gitlens.') ? q.substring('gitlens.'.length) : q;

	const results: SettingsSearchMatch[] = [];
	for (const category of categories) {
		const matchedKeys: string[] = [];
		// Keyless descriptors (integrations/info) can still text-match — track that
		// separately so e.g. searching "GitLab" surfaces the Cloud Integrations
		// category even though its panel contributes no keys
		let matchedKeyless = false;
		for (const control of category.controls) {
			const keys = descriptorKeys(control);
			if (
				keys.length === 0 &&
				control.visibleWhen != null &&
				getValue != null &&
				!evaluateStateExpression(control.visibleWhen, getValue)
			) {
				continue;
			}

			if (
				keys.some(k => k.toLowerCase().includes(keyQuery)) ||
				stripLinks(descriptorText(control)).toLowerCase().includes(q)
			) {
				matchedKeys.push(...keys);
				matchedKeyless ||= keys.length === 0;
			}
		}
		if (
			category.master != null &&
			(category.master.key.toLowerCase().includes(keyQuery) || category.master.label.toLowerCase().includes(q))
		) {
			matchedKeys.push(category.master.key);
		}

		if (
			matchedKeys.length ||
			matchedKeyless ||
			stripLinks(`${category.name} ${category.hint}`).toLowerCase().includes(q)
		) {
			results.push({ category: category, matchedKeys: matchedKeys });
		}
	}
	return results;
}
