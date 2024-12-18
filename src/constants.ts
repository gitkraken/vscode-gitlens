export const extensionPrefix = 'gitlens';
export const quickPickTitleMaxChars = 80;

export const experimentalBadge = 'ᴇxᴘᴇʀɪᴍᴇɴᴛᴀʟ';
export const previewBadge = 'ᴘʀᴇᴠɪᴇᴡ';
export const proBadge = 'ᴘʀᴏ';
export const proBadgeSuperscript = 'ᴾᴿᴼ';

export type AnnotationStatus = 'computing' | 'computed';

export const enum CharCode {
	/**
	 * The `#` character.
	 */
	Hash = 35,
	/**
	 * The `/` character.
	 */
	Slash = 47,
	Digit0 = 48,
	Digit1 = 49,
	Digit2 = 50,
	Digit3 = 51,
	Digit4 = 52,
	Digit5 = 53,
	Digit6 = 54,
	Digit7 = 55,
	Digit8 = 56,
	Digit9 = 57,
	/**
	 * The `\` character.
	 */
	Backslash = 92,
	A = 65,
	B = 66,
	C = 67,
	D = 68,
	E = 69,
	F = 70,
	Z = 90,
	a = 97,
	b = 98,
	c = 99,
	d = 100,
	e = 101,
	f = 102,
	z = 122,
}

export type GitConfigKeys =
	| `branch.${string}.${'gk' | 'vscode'}-merge-base`
	| `branch.${string}.gk-target-base`
	| `branch.${string}.gk-associated-issues`
	| `branch.${string}.github-pr-owner-number`;

export const enum GlyphChars {
	AngleBracketLeftHeavy = '\u2770',
	AngleBracketRightHeavy = '\u2771',
	ArrowBack = '\u21a9',
	ArrowDown = '\u2193',
	ArrowDownUp = '\u21F5',
	ArrowDropRight = '\u2937',
	ArrowHeadRight = '\u27A4',
	ArrowLeft = '\u2190',
	ArrowLeftDouble = '\u21d0',
	ArrowLeftRight = '\u2194',
	ArrowLeftRightDouble = '\u21d4',
	ArrowLeftRightDoubleStrike = '\u21ce',
	ArrowLeftRightLong = '\u27f7',
	ArrowRight = '\u2192',
	ArrowRightDouble = '\u21d2',
	ArrowRightHollow = '\u21e8',
	ArrowUp = '\u2191',
	ArrowUpDown = '\u21C5',
	ArrowUpRight = '\u2197',
	ArrowsHalfLeftRight = '\u21cb',
	ArrowsHalfRightLeft = '\u21cc',
	ArrowsLeftRight = '\u21c6',
	ArrowsRightLeft = '\u21c4',
	Asterisk = '\u2217',
	Bullseye = '\u25CE',
	Check = '\u2714',
	Dash = '\u2014',
	Dot = '\u2022',
	Ellipsis = '\u2026',
	EnDash = '\u2013',
	Envelope = '\u2709',
	EqualsTriple = '\u2261',
	Flag = '\u2691',
	FlagHollow = '\u2690',
	MiddleEllipsis = '\u22EF',
	MuchLessThan = '\u226A',
	MuchGreaterThan = '\u226B',
	Pencil = '\u270E',
	Space = '\u00a0',
	SpaceThin = '\u2009',
	SpaceThinnest = '\u200A',
	SquareWithBottomShadow = '\u274F',
	SquareWithTopShadow = '\u2750',
	Warning = '\u26a0',
	ZeroWidthSpace = '\u200b',
}

export const imageMimetypes: Record<string, string> = Object.freeze({
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.jpe': 'image/jpeg',
	'.webp': 'image/webp',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
	'.bmp': 'image/bmp',
});

export const keys = Object.freeze([
	'left',
	'alt+left',
	'ctrl+left',
	'right',
	'alt+right',
	'ctrl+right',
	'alt+,',
	'alt+.',
	'alt+enter',
	'ctrl+enter',
	'escape',
] as const);
export type Keys = (typeof keys)[number];

export const enum Schemes {
	File = 'file',
	Git = 'git',
	GitHub = 'github',
	GitLens = 'gitlens',
	PRs = 'pr',
	Remote = 'vscode-remote',
	Vsls = 'vsls',
	VslsScc = 'vsls-scc',
	Virtual = 'vscode-vfs',
}

export const trackableSchemes = Object.freeze(
	new Set<Schemes>([
		Schemes.File,
		Schemes.Git,
		Schemes.GitLens,
		Schemes.PRs,
		Schemes.Remote,
		Schemes.Vsls,
		Schemes.VslsScc,
		Schemes.Virtual,
		Schemes.GitHub,
	]),
);

const utm = 'utm_source=gitlens-extension&utm_medium=in-app-links';
export const urls = Object.freeze({
	codeSuggest: `https://gitkraken.com/solutions/code-suggest?${utm}`,
	cloudPatches: `https://gitkraken.com/solutions/cloud-patches?${utm}`,
	graph: `https://gitkraken.com/solutions/commit-graph?${utm}`,
	launchpad: `https://gitkraken.com/solutions/launchpad?${utm}`,
	platform: `https://gitkraken.com/devex?${utm}`,
	pricing: `https://gitkraken.com/gitlens/pricing?${utm}`,
	proFeatures: `https://gitkraken.com/gitlens/pro-features?${utm}`,
	security: `https://help.gitkraken.com/gitlens/security?${utm}`,
	workspaces: `https://gitkraken.com/solutions/workspaces?${utm}`,

	cli: `https://gitkraken.com/cli?${utm}`,
	browserExtension: `https://gitkraken.com/browser-extension?${utm}`,
	desktop: `https://gitkraken.com/git-client?${utm}`,

	githubIssues: `https://github.com/gitkraken/vscode-gitlens/issues/?${utm}`,
	githubDiscussions: `https://github.com/gitkraken/vscode-gitlens/discussions/?${utm}`,
	helpCenter: `https://help.gitkraken.com/gitlens/gitlens-start-here/?${utm}`,
	helpCenterHome: `https://help.gitkraken.com/gitlens/home-view/?${utm}`,
	releaseNotes: `https://help.gitkraken.com/gitlens/gitlens-release-notes-current/?${utm}`,

	acceleratePrReviews: `https://help.gitkraken.com/gitlens/gitlens-start-here/?${utm}#accelerate-pr-reviews`,
	communityVsPro: `https://help.gitkraken.com/gitlens/gitlens-community-vs-gitlens-pro/?${utm}`,
	interactiveCodeHistory: `https://help.gitkraken.com/gitlens/gitlens-start-here/?${utm}#interactive-code-history`,
	startIntegrations: `https://help.gitkraken.com/gitlens/gitlens-start-here/?${utm}#improve-workflows-with-integrations`,
	streamlineCollaboration: `https://help.gitkraken.com/gitlens/gitlens-start-here/?${utm}#streamline-collaboration`,
});

export type WalkthroughSteps =
	| 'welcome-in-trial'
	| 'welcome-paid'
	| 'welcome-in-trial-expired-eligible'
	| 'welcome-in-trial-expired'
	| 'get-started-community'
	| 'visualize-code-history'
	| 'accelerate-pr-reviews'
	| 'streamline-collaboration'
	| 'improve-workflows-with-integrations';
