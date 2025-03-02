import type {
	Command,
	CommandDefinition,
	Keybinding,
	Menu,
	MenuLocations,
	Submenu,
	SubmenuDefinition,
	ContributionsJson,
	PackageJson,
	ViewDefinition,
	View,
} from './contributions/models';
import {
	ContributesBuilder,
	menuLocations,
	MenuSorter,
	parseGroup,
	validateAndRewriteWhenClause,
} from './contributions/contributionsBuilder.mts';
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser } from './contributions/whenParser.mts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const args = process.argv.slice(2);

const extract = args.indexOf('--extract') >= 0;
const validate = args.indexOf('--validate') >= 0;

if (extract) {
	extractContributionsFromPackageJson();
} else {
	generateContributionsIntoPackageJson();
}

/** Generates the `contributions.json` from the contributes configuration in `package.json` */
function extractContributionsFromPackageJson(): void {
	console.log('Extracting contributions from package.json into contributions.json...');

	const commands = new Map<string, CommandDefinition>();
	const submenus = new Map<string, SubmenuDefinition>();
	const keybindings: ContributionsJson['keybindings'] = [];
	const views = new Map<string, ViewDefinition>();

	const packageJson: PackageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

	// Load commands from package.json
	for (const cmd of packageJson.contributes.commands.sort((a: Command, b: Command) =>
		a.command.localeCompare(b.command),
	)) {
		commands.set(cmd.command, {
			id: cmd.command,
			label: cmd.title,
			commandPalette: true,
			enablement: cmd.enablement,
			icon: cmd.icon,
		});
	}

	// Load submenus from package.json
	for (const submenu of packageJson.contributes.submenus.sort((a: Submenu, b: Submenu) => a.id.localeCompare(b.id))) {
		submenus.set(submenu.id, {
			id: submenu.id,
			label: submenu.label,
			icon: submenu.icon,
		});
	}

	// Load (add) keybindings from package.json
	for (const kb of packageJson.contributes.keybindings.sort((a: Keybinding, b: Keybinding) =>
		a.key.localeCompare(b.key),
	)) {
		const command = commands.get(kb.command);
		if (command) {
			(command.keybindings ??= []).push({
				key: kb.key,
				when: kb.when,
				mac: kb.mac,
				linux: kb.linux,
				win: kb.win,
				args: kb.args,
			});
		} else {
			keybindings.push({
				command: kb.command,
				key: kb.key,
				when: kb.when,
				mac: kb.mac,
				linux: kb.linux,
				win: kb.win,
				args: kb.args,
			});
		}
	}

	const parser = new Parser();

	// Load (add) menu locations from package.json
	for (const [location, items] of Object.entries(packageJson.contributes.menus).sort(([a], [b]) =>
		a.localeCompare(b),
	) as [MenuLocations, Menu[]][]) {
		if (!menuLocations.includes(location) && !submenus.has(location)) {
			console.error(`Invalid menu location '${location}'`);
			debugger;
			continue;
		}

		for (const item of items) {
			if (item.command) {
				const command = commands.get(item.command);
				if (command) {
					if (location === 'commandPalette') {
						command.commandPalette = item.when ? (item.when === 'false' ? undefined : item.when) : true;
						continue;
					}

					const { group, order } = parseGroup(item.group);

					command.menus ??= Object.create(null);
					const menus = (command.menus![location] ??= []);
					menus.push({
						when: validateAndRewriteWhenClause(parser, location, command.id, item.when),
						group: group,
						order: order,
						alt: item.alt,
					});
				} else {
					console.error(`Missing '${item.command}' command for placement in '${location}'`);
					debugger;
				}
			} else if (item.submenu) {
				const submenu = submenus.get(item.submenu);
				if (submenu) {
					const { group, order } = parseGroup(item.group);

					submenu.menus ??= Object.create(null);
					const menus = (submenu.menus![location] ??= []);
					menus.push({
						when: validateAndRewriteWhenClause(parser, location, submenu.id, item.when),
						group: group,
						order: order,
					});

					if (item.alt) {
						// @ts-expect-error because this is an error case TS won't allow the access
						console.error(`'${item.submenu}' submenu has an invalid alt command`);
						debugger;
					}
				} else {
					console.error(`Missing '${item.submenu}' submenu for placement in '${location}'`);
					debugger;
				}
			} else {
				console.error(
					`Missing '${item.command || item.submenu}' command or submenu for placement in '${location}'`,
				);
				debugger;
			}
		}
	}

	// Load (add) views from package.json
	for (const [container, items] of Object.entries(packageJson.contributes.views)) {
		let order = 0;
		for (const view of items) {
			views.set(view.id, {
				type: view.type,
				id: view.id,
				name: view.name,
				when: view.when,
				contextualTitle: view.contextualTitle,
				icon: view.icon,
				initialSize: view.initialSize,
				visibility: view.visibility,
				container: container,
				order: order++,
			});
		}
	}

	// Load (add) views welcome content from package.json
	for (const viewWelcome of packageJson.contributes.viewsWelcome) {
		const view = views.get(viewWelcome.view);
		if (view) {
			view.welcomeContent ??= [];
			view.welcomeContent.push({ contents: viewWelcome.contents, when: viewWelcome.when });
		} else {
			console.error(`Missing '${viewWelcome.view}' view for welcome content`);
			debugger;
		}
	}

	const sorter = new MenuSorter();

	// Sort the command menu placements
	for (const command of commands.values()) {
		if (command.menus) {
			const entries = Object.entries(command.menus) as [MenuLocations, Menu[]][];
			command.menus = Object.create(null);
			for (const [location, menus] of entries) {
				command.menus![location] = menus.sort(sorter.getSortComparer(location));
			}
		}
	}

	// Sort the submenu menu placements
	for (const submenu of submenus.values()) {
		if (submenu.menus) {
			const entries = Object.entries(submenu.menus) as [MenuLocations, Menu[]][];
			submenu.menus = Object.create(null);
			for (const [location, menus] of entries) {
				submenu.menus![location] = menus.sort(sorter.getSortComparer(location));
			}
		}
	}

	const result: ContributionsJson = {
		$schema: './contributions.schema.json',
		version: 1,
		commands: Object.fromEntries(
			[...commands]
				.map<[string, Omit<CommandDefinition, 'id'>]>(([id, c]) => [
					id,
					{
						label: c.label,
						icon: c.icon,
						enablement: c.enablement,
						commandPalette: c.commandPalette,
						menus: c.menus,
						keybindings: c.keybindings,
					} satisfies Omit<CommandDefinition, 'id'>,
				])
				.sort(([a], [b]) => a.localeCompare(b)),
		),
		submenus: Object.fromEntries(
			[...submenus]
				.map<[string, Omit<SubmenuDefinition, 'id'>]>(([id, s]) => [
					id,
					{
						label: s.label,
						icon: s.icon,
						menus: s.menus,
					} satisfies Omit<SubmenuDefinition, 'id'>,
				])
				.sort(([a], [b]) => a.localeCompare(b)),
		),
		keybindings: keybindings,
		views: Object.fromEntries(
			[...views]
				.map<[string, Omit<ViewDefinition, 'id'>]>(([id, v]) => [
					id,
					{
						type: v.type,
						name: v.name,
						when: v.when,
						contextualTitle: v.contextualTitle,
						icon: v.icon,
						initialSize: v.initialSize,
						visibility: v.visibility,
						container: v.container,
						order: v.order,
						welcomeContent: v.welcomeContent,
					} satisfies Omit<ViewDefinition, 'id'>,
				])
				.sort(([a], [b]) => a.localeCompare(b)),
		),
	};

	writeFileSync(path.join(__dirname, 'contributions.json'), `${JSON.stringify(result, undefined, '\t')}\n`, 'utf8');
}

/** Generates the contributes configuration from `contributions.json` into `package.json` */
function generateContributionsIntoPackageJson(): void {
	console.log("Generating 'package.json' contributions from contributions.json...");

	const builder = new ContributesBuilder();
	builder.load(path.join(__dirname, 'contributions.json'));
	const contributions = builder.build();

	const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

	// Validate that all existing contributions are preserved
	if (validate) {
		console.log('Validating contributions...');
		validateContributions(packageJson.contributes, contributions);
	}

	// Skip writing if there are no changes
	if (
		JSON.stringify(packageJson.contributes.commands) === JSON.stringify(contributions.commands) &&
		JSON.stringify(packageJson.contributes.keybindings) === JSON.stringify(contributions.keybindings) &&
		JSON.stringify(packageJson.contributes.submenus) === JSON.stringify(contributions.submenus) &&
		JSON.stringify(packageJson.contributes.menus) === JSON.stringify(contributions.menus) &&
		JSON.stringify(packageJson.contributes.views) === JSON.stringify(contributions.views) &&
		JSON.stringify(packageJson.contributes.viewsWelcome) === JSON.stringify(contributions.viewsWelcome)
	) {
		console.log("Skipped; No changes detected in 'contributions.json'");
		return;
	}

	// Update package.json
	packageJson.contributes.commands = contributions.commands;
	packageJson.contributes.keybindings = contributions.keybindings;
	packageJson.contributes.menus = contributions.menus;
	packageJson.contributes.submenus = contributions.submenus;
	packageJson.contributes.views = contributions.views;
	packageJson.contributes.viewsWelcome = contributions.viewsWelcome;

	writeFileSync(path.join(__dirname, 'package.json'), `${JSON.stringify(packageJson, undefined, '\t')}\n`, 'utf8');
	console.log("Generated 'package.json' contributions");
}

/** Validates that all existing contributions are preserved in the new contributions */
function validateContributions(existing: PackageJson['contributes'], updated: PackageJson['contributes']): void {
	// Validate commands
	const missingOrDifferentCommands = existing.commands.filter(existingCommand => {
		const updatedCommand = updated.commands.find(c => c.command === existingCommand.command);
		return (
			!updatedCommand ||
			updatedCommand.title !== existingCommand.title ||
			updatedCommand.enablement !== existingCommand.enablement ||
			updatedCommand.category !== existingCommand.category ||
			JSON.stringify(updatedCommand.icon) !== JSON.stringify(existingCommand.icon)
		);
	});
	if (missingOrDifferentCommands.length) {
		debugger;
		throw new Error(
			`Missing or different commands in generated contributions:\n${missingOrDifferentCommands
				.map(c => `${c.command} (${JSON.stringify(c)})`)
				.join('\n')}`,
		);
	}

	// Validate menus
	for (const [location, existingMenus] of Object.entries(existing.menus)) {
		const updatedMenus: Menu[] = updated.menus[location] || [];
		const missingOrDifferentMenus = existingMenus.filter(existingMenu => {
			const updatedMenuPlacements = updatedMenus.filter(
				updatedMenu =>
					(updatedMenu.command && updatedMenu.command === existingMenu.command) ||
					(updatedMenu.submenu && updatedMenu.submenu === existingMenu.submenu),
			);

			return !updatedMenuPlacements.some(
				updatedMenu =>
					updatedMenu &&
					updatedMenu.when === existingMenu.when &&
					updatedMenu.group === existingMenu.group &&
					updatedMenu.alt === existingMenu.alt,
			);
		});
		if (missingOrDifferentMenus.length) {
			debugger;
			throw new Error(
				`Missing or different menus in ${location}:\n${missingOrDifferentMenus
					.map(m => `${m.command || m.submenu} (${JSON.stringify(m)})`)
					.join('\n')}`,
			);
		}
	}

	// Validate submenus
	const missingOrDifferentSubmenus = existing.submenus.filter((existingSubmenu: Submenu) => {
		const updatedSubmenu = updated.submenus.find(s => s.id === existingSubmenu.id);
		return (
			!updatedSubmenu ||
			updatedSubmenu.label !== existingSubmenu.label ||
			JSON.stringify(updatedSubmenu.icon) !== JSON.stringify(existingSubmenu.icon)
		);
	});
	if (missingOrDifferentSubmenus.length) {
		debugger;
		throw new Error(
			`Missing or different submenus in generated contributions:\n${missingOrDifferentSubmenus
				.map(s => `${s.id} (${JSON.stringify(s)})`)
				.join('\n')}`,
		);
	}

	// Validate keybindings
	const missingOrDifferentKeybindings = existing.keybindings.filter((existingKeybinding: Keybinding) => {
		const updatedKeybinding = updated.keybindings.find(
			kb => kb.command === existingKeybinding.command && kb.key === existingKeybinding.key,
		);
		return (
			!updatedKeybinding ||
			updatedKeybinding.when !== existingKeybinding.when ||
			updatedKeybinding.mac !== existingKeybinding.mac ||
			updatedKeybinding.win !== existingKeybinding.win ||
			updatedKeybinding.linux !== existingKeybinding.linux ||
			JSON.stringify(updatedKeybinding.args) !== JSON.stringify(existingKeybinding.args)
		);
	});
	if (missingOrDifferentKeybindings.length) {
		debugger;
		throw new Error(
			`Missing or different keybindings in generated contributions:\n${missingOrDifferentKeybindings
				.map(kb => `${kb.command} (${JSON.stringify(kb)})`)
				.join('\n')}`,
		);
	}

	// Validate views
	for (const [container, existingViews] of Object.entries(existing.views)) {
		const updatedViews: View[] = updated.views[container] || [];
		const missingOrDifferentViews = existingViews.filter(existingView => {
			const updatedView = updatedViews.find(v => v.id === existingView.id);
			return (
				!updatedView ||
				updatedView.type !== existingView.type ||
				updatedView.name !== existingView.name ||
				updatedView.when !== existingView.when ||
				updatedView.contextualTitle !== existingView.contextualTitle ||
				updatedView.icon !== existingView.icon ||
				updatedView.initialSize !== existingView.initialSize ||
				updatedView.visibility !== existingView.visibility
			);
		});
		if (missingOrDifferentViews.length) {
			debugger;
			throw new Error(
				`Missing or different views in generated contributions:\n${missingOrDifferentViews
					.map(v => `${v.id} (${JSON.stringify(v)})`)
					.join('\n')}`,
			);
		}
	}

	// Validate views welcome content
	const missingOrDifferentViewsWelcome = existing.viewsWelcome.filter(existingViewWelcome => {
		const updatedViewWelcome = updated.viewsWelcome.find(
			vw =>
				vw.view === existingViewWelcome.view &&
				vw.contents === existingViewWelcome.contents &&
				vw.when === existingViewWelcome.when,
		);
		return !updatedViewWelcome;
	});
	if (missingOrDifferentViewsWelcome.length) {
		debugger;
		throw new Error(
			`Missing or different views welcome content in generated contributions:\n${missingOrDifferentViewsWelcome
				.map(vw => `${vw.view} (${JSON.stringify(vw)})`)
				.join('\n')}`,
		);
	}
}
