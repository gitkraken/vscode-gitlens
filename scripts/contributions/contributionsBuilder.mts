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
	ViewWelcome,
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
			if (command.commandPalette !== true) {
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
	private readonly sortExpressionSetCache = new Map<string, [string | undefined, string[]]>();
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
		if (!primaryKeys?.length) return this.sortByDefault.bind(this);
		if (primaryKeys.length === 1) return this.sortByCustomWhenClause.bind(this, primaryKeys[0]);

		return this.sortByCustomWhenClause.bind(this, `(?:${primaryKeys.join('|')})`);
	}

	private sortByCustomWhenClause(
		key: string,
		a: Menu | MenuLocationDefinition,
		b: Menu | MenuLocationDefinition,
	): number {
		const [expressionA, setA] = this.getSortableExpressionSet(key, a);
		const [expressionB, setB] = this.getSortableExpressionSet(key, b);

		let value: number;

		if (setA.length && setB.length) {
			value = setA[0].localeCompare(setB[0]);
		} else if (!expressionA) {
			value = 1;
		} else if (!expressionB) {
			value = -1;
		} else {
			value = expressionA.localeCompare(expressionB);
		}

		if (value === 0) {
			value = this.sortByDefault(a, b);
		}

		return value;
	}

	private sortByDefault(a: Menu | MenuLocationDefinition, b: Menu | MenuLocationDefinition): number {
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

	private getSortableExpressionSet(key: string, m: Menu | MenuLocationDefinition): [string | undefined, string[]] {
		const set: string[] = [];
		if (!m.when) return [undefined, set];

		const cacheKey = `${key}:${m.when}`;
		let cached = this.sortExpressionSetCache.get(cacheKey);
		if (cached) return cached;

		let regex = this.regexCache.get(key);
		if (!regex) {
			regex = new RegExp(`${key}(?:\\s+=~\\s+\/(.+?)\/|\\s+[!=]=\\s+(.+?)(?:\\s+[&|]|$))`);
			this.regexCache.set(key, regex);
		}

		const match = regex.exec(m.when);

		let expression = match?.[1];
		if (expression) {
			try {
				const iterator = expand(expression).getIterator();
				for (const v of iterator) {
					set.push(v);
				}
			} catch (ex) {
				debugger;
				console.error(ex);
			}
		} else {
			expression = match?.[2];
			if (expression) {
				set.push(expression);
			}
		}

		if (set.length > 1) {
			set.sort((a, b) => a.localeCompare(b));
		}

		cached = [expression, set];
		this.sortExpressionSetCache.set(cacheKey, cached);
		return cached;
	}
}

function getContextKeysForLocation(
	location: MenuLocations | SubmenuLocations,
): [primary: string[], ...string[]] | undefined {
	switch (location) {
		case 'scm/resourceFolder/context':
			return [['scmResourceFolder'], 'scmResourceGroup', 'scmProvider'];
		case 'scm/resourceGroup/context':
			return [['scmResourceGroup'], 'scmProvider'];
		case 'scm/resourceState/context':
			return [['scmResourceState'], 'scmResourceFolder', 'scmResourceGroup', 'scmProvider'];
		case 'scm/title':
			return [['scmProvider']];
		case 'scm/sourceControl':
			return [['scmProvider']];
		case 'timeline/title':
			return [['timeline']];
		case 'timeline/item/context':
			return [['timelineItem'], 'timeline'];
		case 'view/title':
			return [['view']];
		case 'view/item/context':
			return [['viewItem'], 'view'];
		case 'webview/context':
			return [['webviewItem', 'webviewItems', 'webviewItemGroup']];
		default:
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
	const orderedKeys = [...primary, ...secondaryKeys];
	if (!orderedKeys.length) return when;

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

	const importants: ContextKeyExpression[] = [];
	const others: ContextKeyExpression[] = [];

	for (const exp of expression.expr) {
		let important = false;
		for (const key of orderedKeys) {
			if (exp.keys().some(k => key.includes(k))) {
				important = true;
				importants.push(exp);
			}
		}

		if (!important) {
			others.push(exp);
		}
	}

	// Combine the terms with important ones first
	const rewrittenWhen = [...importants.map(t => t.serialize()), ...others.map(t => t.serialize())].join(' && ');
	const rewrittenExpr = parser.parse(rewrittenWhen);
	if (rewrittenExpr) {
		return rewrittenWhen;
	}

	return when;
}
