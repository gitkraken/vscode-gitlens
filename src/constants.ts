import { TextDocument, TextEditor, window } from 'vscode';

export const quickPickTitleMaxChars = 80;
export const ImageMimetypes: Record<string, string> = {
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.jpe': 'image/jpeg',
	'.webp': 'image/webp',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
	'.bmp': 'image/bmp',
};

export const enum BuiltInCommands {
	CloseActiveEditor = 'workbench.action.closeActiveEditor',
	CloseAllEditors = 'workbench.action.closeAllEditors',
	CursorMove = 'cursorMove',
	Diff = 'vscode.diff',
	EditorScroll = 'editorScroll',
	ExecuteDocumentSymbolProvider = 'vscode.executeDocumentSymbolProvider',
	ExecuteCodeLensProvider = 'vscode.executeCodeLensProvider',
	FocusFilesExplorer = 'workbench.files.action.focusFilesExplorer',
	InstallExtension = 'workbench.extensions.installExtension',
	Open = 'vscode.open',
	OpenFolder = 'vscode.openFolder',
	OpenInTerminal = 'openInTerminal',
	OpenWith = 'vscode.openWith',
	NextEditor = 'workbench.action.nextEditor',
	PreviewHtml = 'vscode.previewHtml',
	RevealLine = 'revealLine',
	SetContext = 'setContext',
	ShowExplorerActivity = 'workbench.view.explorer',
	ShowReferences = 'editor.action.showReferences',
}

export const enum BuiltInGitCommands {
	Publish = 'git.publish',
	Pull = 'git.pull',
	PullRebase = 'git.pullRebase',
	Push = 'git.push',
	PushForce = 'git.pushForce',
	UndoCommit = 'git.undoCommit',
}

export const enum BuiltInGitConfiguration {
	AutoRepositoryDetection = 'git.autoRepositoryDetection',
	FetchOnPull = 'git.fetchOnPull',
	UseForcePushWithLease = 'git.useForcePushWithLease',
}

export const enum Colors {
	GutterBackgroundColor = 'gitlens.gutterBackgroundColor',
	GutterForegroundColor = 'gitlens.gutterForegroundColor',
	GutterUncommittedForegroundColor = 'gitlens.gutterUncommittedForegroundColor',
	TrailingLineBackgroundColor = 'gitlens.trailingLineBackgroundColor',
	TrailingLineForegroundColor = 'gitlens.trailingLineForegroundColor',
	LineHighlightBackgroundColor = 'gitlens.lineHighlightBackgroundColor',
	LineHighlightOverviewRulerColor = 'gitlens.lineHighlightOverviewRulerColor',
	ClosedAutolinkedIssueIconColor = 'gitlens.closedAutolinkedIssueIconColor',
	ClosedPullRequestIconColor = 'gitlens.closedPullRequestIconColor',
	OpenAutolinkedIssueIconColor = 'gitlens.openAutolinkedIssueIconColor',
	OpenPullRequestIconColor = 'gitlens.openPullRequestIconColor',
	MergedPullRequestIconColor = 'gitlens.mergedPullRequestIconColor',
	UnpushlishedChangesIconColor = 'gitlens.unpushlishedChangesIconColor',
	UnpublishedCommitIconColor = 'gitlens.unpublishedCommitIconColor',
	UnpulledChangesIconColor = 'gitlens.unpulledChangesIconColor',
}

export const enum Schemes {
	DebugConsole = 'debug',
	File = 'file',
	Git = 'git',
	GitHub = 'github',
	GitLens = 'gitlens',
	Output = 'output',
	PRs = 'pr',
	Vsls = 'vsls',
	VslsScc = 'vsls-scc',
	Virtual = 'vscode-vfs',
}

export function getEditorIfActive(document: TextDocument): TextEditor | undefined {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document ? editor : undefined;
}

export function isActiveDocument(document: TextDocument): boolean {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document;
}

export function isVisibleDocument(document: TextDocument): boolean {
	if (window.visibleTextEditors.length === 0) return false;

	return window.visibleTextEditors.some(e => e.document === document);
}

export function isTextEditor(editor: TextEditor): boolean {
	const scheme = editor.document.uri.scheme;
	return scheme !== Schemes.Output && scheme !== Schemes.DebugConsole;
}

export function hasVisibleTextEditor(): boolean {
	if (window.visibleTextEditors.length === 0) return false;

	return window.visibleTextEditors.some(e => isTextEditor(e));
}

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
	Check = '✔',
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
