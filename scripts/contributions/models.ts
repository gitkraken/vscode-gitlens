export type IconPath = string | { light: string; dark: string };

export interface Command {
	command: string;
	title: string;
	category?: string;
	icon?: IconPath;
	enablement?: string;
}

export interface CommandDefinition {
	id: string;
	label: string;
	icon?: IconPath;
	enablement?: string;
	commandPalette?: true | string;
	menus?: Record<string, MenuLocationDefinition[]>;
	keybindings?: KeybindingDefinition[];
}

export interface Submenu {
	id: string;
	label: string;
	icon?: IconPath;
}

export interface SubmenuDefinition extends Submenu {
	menus?: Record<string, MenuLocationDefinition[]>;
}

export interface Keybinding {
	command: string;
	key: string;
	when?: string;
	mac?: string;
	linux?: string;
	win?: string;
	args?: any;
}

export type KeybindingDefinition = Omit<Keybinding, 'command'>;

export type Menu =
	| { command: string; submenu?: never; when?: string; group?: string; alt?: string }
	| { command?: never; submenu: string; when?: string; group?: string; alt?: never };

export interface MenuLocationDefinition {
	when?: string;
	group?: string;
	order?: number;
	alt?: string;
}

export type MenuLocations =
	| 'commandPalette'
	| 'comments/comment/title'
	| 'comments/comment/context'
	| 'comments/commentThread/title'
	| 'comments/commentThread/context'
	| 'editor/title'
	| 'editor/title/context'
	| 'editor/title/run'
	| 'editor/context'
	| 'editor/context/copy'
	| 'editor/lineNumber/context'
	| 'explorer/context'
	| 'extension/context'
	| 'git.commit'
	| 'menuBar/edit/copy'
	| 'scm/title'
	| 'scm/sourceControl'
	| 'scm/change/title'
	| 'scm/resourceGroup/context'
	| 'scm/resourceFolder/context'
	| 'scm/resourceState/context'
	| 'terminal/title/context'
	| 'terminal/context'
	| 'timeline/title'
	| 'timeline/item/context'
	| 'view/title'
	| 'view/item/context'
	| 'webview/context';

export type SubmenuLocations = `gitlens/${string}`;

export interface View {
	type?: 'webview' | 'tree';
	id: string;
	name: string;
	when?: string;
	contextualTitle?: string;
	icon?: IconPath;
	initialSize?: number;
	visibility?: 'visible' | 'collapsed';
}

export interface ViewWelcome {
	view: string;
	contents: string;
	when?: string;
}

export interface ViewDefinition extends View {
	container: string;
	order: number;
	welcomeContent?: ViewWelcomeDefinition[];
}

export type ViewWelcomeDefinition = Omit<ViewWelcome, 'view'>;

export interface ContributionsJson {
	$schema: string;
	version: number;
	commands: Record<string, Omit<CommandDefinition, 'id'>>;
	submenus: Record<string, Omit<SubmenuDefinition, 'id'>>;
	keybindings: Keybinding[];
	views: Record<string, Omit<ViewDefinition, 'id'>>;
}

export interface PackageJson {
	contributes: {
		commands: Command[];
		menus: Record<MenuLocations, Menu[]>;
		submenus: Submenu[];
		keybindings: Keybinding[];
		views: Record<string, View[]>;
		viewsWelcome: ViewWelcome[];
	};
}
