import type {
	Command,
	ContributionsJson,
	CommandDefinition,
	Keybinding,
	Menu,
	MenuLocationDefinition,
	MenuLocations,
	PackageJson,
	Submenu,
	SubmenuDefinition,
	ViewDefinition,
	View,
	SubmenuLocations,
} from './models';
import * as fs from 'fs';
import { expand } from 'regex-to-strings';
import { ContextKeyExprType, Parser, type ContextKeyExpression } from './whenParser.mts';

export const menuLocations: MenuLocations[] = [
	'commandPalette',
	'comments/comment/title',
	'comments/comment/context',
	'comments/commentThread/title',
	'comments/commentThread/context',
	'editor/title',
	'editor/title/context',
	'editor/title/run',
	'editor/context',
	'editor/context/copy',
	'editor/lineNumber/context',
	'explorer/context',
	'extension/context',
	'git.commit',
	'menuBar/edit/copy',
	'scm/title',
	'scm/sourceControl',
	'scm/change/title',
	'scm/resourceGroup/context',
	'scm/resourceFolder/context',
	'scm/resourceState/context',
	'terminal/title/context',
	'terminal/context',
	'timeline/title',
	'timeline/item/context',
	'view/title',
	'view/item/context',
	'webview/context',
];

type SortableExpression = { key: string | undefined; expression: string | undefined; values: string[] };
const emptySortableExpression: SortableExpression = { key: undefined, expression: undefined, values: [] };

export class ContributesBuilder {
	private commands: Record<string, CommandDefinition[]> = Object.create(null);
	private keybindings: Keybinding[] = [];
	private views: Record<string, ViewDefinition> = Object.create(null);
	private submenus: Record<string, SubmenuDefinition[]> = Object.create(null);

	load(path: string): void {
		const contributions: ContributionsJson = JSON.parse(fs.readFileSync(path, 'utf8'));
		for (const [id, command] of Object.entries(contributions.commands)) {
			this.addCommand(id, command);
		}
		for (const [id, submenu] of Object.entries(contributions.submenus)) {
			this.addSubmenu(id, submenu);
		}
		for (const keybinding of contributions.keybindings) {
			this.addKeybinding(keybinding);
		}
		for (const [id, view] of Object.entries(contributions.views)) {
			this.addView(id, view);
		}
	}

	addCommand(id: string, command: Omit<CommandDefinition, 'id'>): this {
		this.commands[id] ??= [];
		this.commands[id].push({ ...command, id: id });
		return this;
	}

	addKeybinding(keybinding: Keybinding): this {
		this.keybindings.push(keybinding);
		return this;
	}

	addSubmenu(id: string, submenu: Omit<SubmenuDefinition, 'id'>): this {
		this.submenus[id] ??= [];
		this.submenus[id].push({ ...submenu, id: id });
		return this;
	}

	addView(id: string, view: Omit<ViewDefinition, 'id'>): this {
		this.views[id] = { ...view, id: id };
		return this;
	}

	build(): PackageJson['contributes'] {
		return {
			commands: this.buildCommands(),
			menus: this.buildMenus(),
			submenus: this.buildSubmenus(),
			keybindings: this.buildKeybindings(),
			views: this.buildViews(),
			viewsWelcome: this.buildViewsWelcome(),
		};
	}

	private buildCommands(): Command[] {
		return Object.values(this.commands)
			.flat()
			.map<Command>(c => ({
				command: c.id,
				title: c.label,
				category: c.commandPalette != null ? 'GitLens' : undefined,
				icon: c.icon,
				enablement: c.enablement,
			}));
	}

	private buildMenus(): Record<string, Menu[]> {
		let result: Record<string, Menu[]> = Object.create(null);

		const sorter = new MenuSorter(this.getItemFromMenu.bind(this));
		const parser = new Parser();

		// Handle command menu locations
		for (const command of Object.values(this.commands).flat()) {
			// Handle command palette
			if (command.commandPalette !== true && command.commandPalette !== 'true') {
				result.commandPalette ??= [];
				result.commandPalette.push({
					command: command.id,
					when: command.commandPalette == null ? 'false' : command.commandPalette,
				});
			}

			// Handle other menu locations
			if (command.menus) {
				for (const [location, items] of Object.entries(command.menus) as [
					MenuLocations,
					MenuLocationDefinition[],
				][]) {
					const menus = (result[location] ??= []);
					menus.push(
						...items.map(i => ({
							command: command.id,
							when: validateAndRewriteWhenClause(parser, location, command.id, i.when),
							group: i.group != null && i.order != null ? `${i.group}@${i.order}` : i.group,
							alt: i.alt,
						})),
					);
				}
			}
		}

		// Handle submenu menu locations
		for (const submenu of Object.values(this.submenus).flat()) {
			if (submenu.menus) {
				for (const [location, items] of Object.entries(submenu.menus) as [
					SubmenuLocations,
					MenuLocationDefinition[],
				][]) {
					const menus = (result[location] ??= []);
					menus.push(
						...items.map(i => ({
							submenu: submenu.id,
							when: validateAndRewriteWhenClause(parser, location, submenu.id, i.when),
							group: i.group != null && i.order != null ? `${i.group}@${i.order}` : i.group,
						})),
					);
				}
			}
		}

		const entries = Object.entries(result).sort(([a], [b]) => a.localeCompare(b)) as [MenuLocations, Menu[]][];

		result = Object.create(null);
		for (const [location, menus] of entries) {
			result[location] = menus.sort(sorter.getSortComparer(location));
		}

		return result;
	}

	private buildSubmenus(): Submenu[] {
		return Object.values(this.submenus)
			.flat()
			.map<Submenu>(s => ({
				id: s.id,
				label: s.label,
				icon: s.icon,
			}));
	}

	private buildKeybindings(): Keybinding[] {
		return this.keybindings.concat(
			Object.values(this.commands)
				.flat()
				.filter(c => c.keybindings?.length)
				.flatMap(c =>
					c.keybindings!.map(keybinding => ({
						command: c.id,
						key: keybinding.key,
						when: keybinding.when,
						mac: keybinding.mac,
						linux: keybinding.linux,
						win: keybinding.win,
						args: keybinding.args,
					})),
				),
		);
	}

	private buildViews(): PackageJson['contributes']['views'] {
		const entries = Object.entries(this.views).sort(([a], [b]) => a.localeCompare(b));
		const result = entries
			.map(v => v[1])
			.reduce(
				(result, v) => {
					result[v.container] ??= [];
					result[v.container].push({
						type: v.type,
						id: v.id,
						name: v.name,
						when: v.when,
						contextualTitle: v.contextualTitle,
						icon: v.icon,
						initialSize: v.initialSize,
						visibility: v.visibility,
					});
					return result;
				},
				Object.create(null) as Record<string, View[]>,
			);

		// Sort each container's views by their order
		for (const container in result) {
			result[container].sort((a, b) => {
				const orderA = this.views[a.id]?.order ?? 0;
				const orderB = this.views[b.id]?.order ?? 0;
				return orderA - orderB;
			});
		}

		return result;
	}

	private buildViewsWelcome(): PackageJson['contributes']['viewsWelcome'] {
		const entries = Object.entries(this.views).sort(([a], [b]) => a.localeCompare(b));
		return entries
			.map(v => v[1])
			.flat()
			.filter(v => v.welcomeContent?.length)
			.flatMap(v =>
				v.welcomeContent!.map(wc => ({
					view: v.id,
					contents: wc.contents,
					when: wc.when,
				})),
			);
	}

	private getItemFromMenu(m: Menu): CommandDefinition | SubmenuDefinition | undefined {
		let item: CommandDefinition | SubmenuDefinition | undefined;
		if ('command' in m) {
			item = Object.values(this.commands)
				.flat()
				.find(c => c.id === m.command);
		} else if ('submenu' in m) {
			item = Object.values(this.submenus)
				.flat()
				.find(c => c.id === m.submenu);
		}

		if (!item) {
			console.error(`Missing command or submenu for ${m.command || m.submenu}`);
			debugger;
		}
		return item;
	}
}

export class MenuSorter {
	private readonly sortExpressionCache = new Map<string, SortableExpression>();
	private readonly regexCache = new Map<string, RegExp>();
	private readonly getItem:
		| ((m: Menu | MenuLocationDefinition) => CommandDefinition | SubmenuDefinition | undefined)
		| undefined;

	constructor(getItem?: MenuSorter['getItem']) {
		this.getItem = getItem;
	}

	getSortComparer(
		location: MenuLocations,
	): (a: Menu | MenuLocationDefinition, b: Menu | MenuLocationDefinition) => number {
		if (location === 'commandPalette') {
			return (a, b) => {
				const commandA = this.getItem?.(a)?.id;
				const commandB = this.getItem?.(b)?.id;

				if (commandA === commandB) return 0;
				if (!commandA) return 1;
				if (!commandB) return -1;
				return commandA.localeCompare(commandB);
			};
		}

		const primaryKeys = getContextKeysForLocation(location)?.[0];
		if (!primaryKeys?.length) return this.sortByGroup.bind(this, location);

		return this.sortByCustomWhenClause.bind(this, location, `(${primaryKeys.join('|')})`);
	}

	private sortByCustomWhenClause(
		location: MenuLocations,
		key: string,
		a: Menu | MenuLocationDefinition,
		b: Menu | MenuLocationDefinition,
	): number {
		const { key: keyA, expression: expressionA, values: valuesA } = this.getSortableExpression(key, a);
		const { key: keyB, expression: expressionB, values: valuesB } = this.getSortableExpression(key, b);

		let value = 0;

		if (keyA === keyB) {
			if (valuesA.length && valuesB.length) {
				value = valuesA[0].localeCompare(valuesB[0]);
			} else if (expressionA !== expressionB) {
				if (!expressionA) {
					value = 1;
				} else if (!expressionB) {
					value = -1;
				} else {
					value = expressionA.localeCompare(expressionB);
				}
			}
		} else if (keyA && keyB) {
			value = keyA.localeCompare(keyB);
		}

		if (value === 0) {
			value = this.sortByGroup(location, a, b);
		}

		return value;
	}

	private sortByGroup(
		_location: MenuLocations,
		a: Menu | MenuLocationDefinition,
		b: Menu | MenuLocationDefinition,
	): number {
		if (a.group === b.group) return 0;

		let { group: groupA, order: orderA } = parseGroup(a.group);
		let { group: groupB, order: orderB } = parseGroup(b.group);

		if (groupA !== groupB) {
			if (!groupA) return 1;
			if (!groupB) return -1;

			if (groupA === 'navigation' || groupA === 'inline') return -1;
			if (groupB === 'navigation' || groupB === 'inline') return 1;

			const value = groupA.localeCompare(groupB);
			if (value !== 0) return value;
		}

		orderA ??= 0;
		orderB ??= 0;

		if (orderA < orderB) return -1;
		if (orderA > orderB) return 1;

		const labelA = this.getItem?.(a)?.label;
		const labelB = this.getItem?.(b)?.label;

		if (!labelA) return 1;
		if (!labelB) return -1;

		return labelA.localeCompare(labelB);
	}

	private getSortableExpression(keys: string, m: Menu | MenuLocationDefinition): SortableExpression {
		const values: string[] = [];
		if (!m.when) return emptySortableExpression;

		const cacheKey = `${keys}:${m.when}`;
		let cached = this.sortExpressionCache.get(cacheKey);
		if (cached) return cached;

		let regex = this.regexCache.get(keys);
		if (!regex) {
			regex = new RegExp(`${keys}(?:\\s+=~\\s+\/(.+?)\/|\\s+(?:[!=]=|in|not in)\\s+(.+?)(?:\\s+[&|]|$))`);
			this.regexCache.set(keys, regex);
		}

		const match = regex.exec(m.when);

		const key = match?.[1];
		let expression = match?.[2];
		if (expression) {
			try {
				const iterator = expand(expression).getIterator();
				for (const v of iterator) {
					values.push(v);
				}
			} catch (ex) {
				debugger;
				console.error(ex);
			}
		} else {
			expression = match?.[3];
			if (expression) {
				values.push(expression);
			}
		}

		if (values.length > 1) {
			values.sort((a, b) => a.localeCompare(b));
		}

		cached = { key: key, expression: expression, values: values };
		this.sortExpressionCache.set(cacheKey, cached);
		return cached;
	}
}

const configRegex = /^config\./;
const orderedContextKeysByLocation = new Map<string, [primary: string[], ...(string | RegExp)[]]>([
	[
		'scm/resourceFolder/context',
		[['scmResourceFolder'], 'scmResourceGroup', 'scmProvider', 'gitlens:enabled', configRegex],
	],
	['scm/resourceGroup/context', [['scmResourceGroup'], 'scmProvider', 'gitlens:enabled', configRegex]],
	[
		'scm/resourceState/context',
		[['scmResourceState'], 'scmResourceFolder', 'scmResourceGroup', 'scmProvider', 'gitlens:enabled', configRegex],
	],
	['scm/title', [['scmProvider'], 'gitlens:enabled', configRegex]],
	['scm/sourceControl', [['scmProvider'], 'gitlens:enabled', configRegex]],
	['timeline/title', [['timeline'], 'gitlens:enabled', configRegex]],
	['timeline/item/context', [['timelineItem'], 'timeline', 'gitlens:enabled', configRegex]],
	['view/title', [['view', 'gitlens:views:scm:grouped:view'], configRegex]],
	['view/item/context', [['viewItem'], 'gitlens:views:scm:grouped:view', 'view', configRegex, 'listMultiSelection']],
	['webview/context', [['webviewItem', 'webviewItems', 'webviewItemGroup'], configRegex, 'listMultiSelection']],
	[
		'editor/',
		[['activeWebviewPanelId', 'resourceScheme', 'resource'], 'editorTextFocus', 'gitlens:enabled', configRegex],
	],
	['explorer/', [[], 'explorerResourceIsRoot', 'explorerResourceIsFolder', 'gitlens:enabled', configRegex]],
	[
		'gitlens/',
		[
			[
				'viewItem',
				'gitlens:views:scm:grouped:view',
				'view',
				'webviewItem',
				'webviewItems',
				'webviewItemGroup',
				'scmResourceState',
				'scmResourceFolder',
				'scmResourceGroup',
				'scmProvider',
				'timelineItem',
				'timeline',
				'activeWebviewPanelId',
				'resource',
				'resourceScheme',
			],
			'explorerResourceIsRoot',
			'explorerResourceIsFolder',
			configRegex,
			'listMultiSelection',
		],
	],
]);

function getContextKeysForLocation(
	location: MenuLocations | SubmenuLocations,
): [primary: string[], ...(string | RegExp)[]] | undefined {
	switch (location) {
		case 'scm/resourceFolder/context':
		case 'scm/resourceGroup/context':
		case 'scm/resourceState/context':
		case 'scm/title':
		case 'scm/sourceControl':
		case 'timeline/title':
		case 'timeline/item/context':
		case 'view/title':
		case 'view/item/context':
		case 'webview/context':
			return orderedContextKeysByLocation.get(location);
		default:
			if (location.startsWith('editor/')) {
				return orderedContextKeysByLocation.get('editor/');
			}

			if (location.startsWith('explorer/')) {
				return orderedContextKeysByLocation.get('explorer/');
			}

			if (location.startsWith('gitlens/')) {
				return orderedContextKeysByLocation.get('gitlens/');
			}

			return undefined;
	}
}

export interface ParsedGroup {
	group: string | undefined;
	order: number | undefined;
}

export function parseGroup(group: string | undefined): ParsedGroup {
	if (!group) return { group: undefined, order: undefined };

	const index = group.lastIndexOf('@');
	if (index >= 0) {
		return {
			group: group.substring(0, index),
			order: Number(group.substring(index + 1)) ?? undefined,
		};
	}

	return { group: group, order: undefined };
}

export function validateAndRewriteWhenClause(
	parser: Parser,
	location: MenuLocations | SubmenuLocations,
	id: string,
	when: string | undefined,
): string | undefined {
	if (!when) return when;

	const keys = getContextKeysForLocation(location);
	if (!keys) return when;

	const [primary, ...secondaryKeys] = keys;
	const orderedImportantKeys = [...primary, ...secondaryKeys];
	if (!orderedImportantKeys.length) return when;

	let expression: ContextKeyExpression | undefined;

	try {
		expression = parser.parse(when);
	} catch (ex) {
		debugger;
		console.error(`Error parsing '${id}' command when clause for placement in '${location}': ${ex}`);
		throw ex;
	}

	// If not an AND expression, preserve the original since we can't safely reorder
	if (!expression || expression.type !== ContextKeyExprType.And) return when;

	const importants: { index: number; expr: ContextKeyExpression }[] = [];
	const others: ContextKeyExpression[] = [];

	for (const exp of expression.expr) {
		if (exp.type === ContextKeyExprType.Or) return when;

		const keys = exp.keys();

		let i = -1;
		let important = false;
		for (const importantKey of orderedImportantKeys) {
			i++;

			if (
				(typeof importantKey === 'string' && keys.includes(importantKey)) ||
				(importantKey instanceof RegExp && keys.some(k => importantKey.test(k)))
			) {
				important = true;
				break;
			}
		}

		if (important) {
			importants.push({ index: i, expr: exp });
		} else {
			others.push(exp);
		}
	}

	if (!importants.length) return when;

	importants.sort((a, b) => a.index - b.index);

	// Combine the terms with important ones first
	const rewrittenWhen = [...importants.map(e => e.expr.serialize()), ...others.map(e => e.serialize())].join(' && ');
	const rewrittenExpr = parser.parse(rewrittenWhen);
	if (rewrittenExpr) {
		return rewrittenWhen;
	}

	return when;
}
