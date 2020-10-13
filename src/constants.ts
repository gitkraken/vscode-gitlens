'use strict';
import { commands, TextDocument, TextEditor, window } from 'vscode';
import { ViewShowBranchComparison } from './config';

export const applicationInsightsKey = 'a9c302f8-6483-4d01-b92c-c159c799c679';
export const extensionId = 'gitlens';
export const extensionOutputChannelName = 'GitLens';
export const extensionQualifiedId = `eamodio.${extensionId}`;
export const extensionTerminalName = 'GitLens';

export const quickPickTitleMaxChars = 80;

export enum BuiltInCommands {
	CloseActiveEditor = 'workbench.action.closeActiveEditor',
	CloseAllEditors = 'workbench.action.closeAllEditors',
	CursorMove = 'cursorMove',
	Diff = 'vscode.diff',
	EditorScroll = 'editorScroll',
	ExecuteDocumentSymbolProvider = 'vscode.executeDocumentSymbolProvider',
	ExecuteCodeLensProvider = 'vscode.executeCodeLensProvider',
	FocusFilesExplorer = 'workbench.files.action.focusFilesExplorer',
	Open = 'vscode.open',
	OpenFolder = 'vscode.openFolder',
	OpenInTerminal = 'openInTerminal',
	NextEditor = 'workbench.action.nextEditor',
	PreviewHtml = 'vscode.previewHtml',
	RevealLine = 'revealLine',
	SetContext = 'setContext',
	ShowExplorerActivity = 'workbench.view.explorer',
	ShowReferences = 'editor.action.showReferences',
}

export enum CommandContext {
	ActiveFileStatus = 'gitlens:activeFileStatus',
	AnnotationStatus = 'gitlens:annotationStatus',
	CanToggleCodeLens = 'gitlens:canToggleCodeLens',
	Disabled = 'gitlens:disabled',
	Enabled = 'gitlens:enabled',
	HasRemotes = 'gitlens:hasRemotes',
	HasConnectedRemotes = 'gitlens:hasConnectedRemotes',
	Key = 'gitlens:key',
	Readonly = 'gitlens:readonly',
	ViewsCanCompare = 'gitlens:views:canCompare',
	ViewsCanCompareFile = 'gitlens:views:canCompare:file',
	ViewsCommitsMyCommitsOnly = 'gitlens:views:commits:myCommitsOnly',
	ViewsCompareKeepResults = 'gitlens:views:compare:keepResults',
	ViewsFileHistoryCursorFollowing = 'gitlens:views:fileHistory:cursorFollowing',
	ViewsFileHistoryEditorFollowing = 'gitlens:views:fileHistory:editorFollowing',
	ViewsLineHistoryEditorFollowing = 'gitlens:views:lineHistory:editorFollowing',
	ViewsRepositoriesAutoRefresh = 'gitlens:views:repositories:autoRefresh',
	ViewsSearchKeepResults = 'gitlens:views:search:keepResults',
	Vsls = 'gitlens:vsls',
}

export function setCommandContext(key: CommandContext | string, value: any) {
	return commands.executeCommand(BuiltInCommands.SetContext, key, value);
}

export enum DocumentSchemes {
	DebugConsole = 'debug',
	File = 'file',
	Git = 'git',
	GitLens = 'gitlens',
	Output = 'output',
	PRs = 'pr',
	Vsls = 'vsls',
}

export function getEditorIfActive(document: TextDocument): TextEditor | undefined {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document ? editor : undefined;
}

export function isActiveDocument(document: TextDocument): boolean {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document;
}

export function isTextEditor(editor: TextEditor): boolean {
	const scheme = editor.document.uri.scheme;
	return scheme !== DocumentSchemes.Output && scheme !== DocumentSchemes.DebugConsole;
}

export function hasVisibleTextEditor(): boolean {
	if (window.visibleTextEditors.length === 0) return false;

	return window.visibleTextEditors.some(e => isTextEditor(e));
}

export enum GlyphChars {
	AngleBracketLeftHeavy = '\u2770',
	AngleBracketRightHeavy = '\u2771',
	ArrowBack = '\u21a9',
	ArrowDown = '\u2193',
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
	ArrowUpRight = '\u2197',
	ArrowsHalfLeftRight = '\u21cb',
	ArrowsHalfRightLeft = '\u21cc',
	ArrowsLeftRight = '\u21c6',
	ArrowsRightLeft = '\u21c4',
	Asterisk = '\u2217',
	Check = '\u2713',
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
	ZeroWidthSpace = '\u200b',
}

export enum GlobalState {
	GitLensVersion = 'gitlensVersion',
}

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

export interface BranchComparison {
	ref: string;
	notation: '..' | '...' | undefined;
	type: Exclude<ViewShowBranchComparison, false> | undefined;
}

export interface BranchComparisons {
	[id: string]: string | BranchComparison;
}

export interface NamedRef {
	label?: string;
	ref: string;
}

export interface PinnedComparison {
	path: string;
	ref1: NamedRef;
	ref2: NamedRef;
	notation: '..' | '...' | undefined;
}

export interface PinnedComparisons {
	[id: string]: PinnedComparison;
}

export interface StarredBranches {
	[id: string]: boolean;
}

export interface StarredRepositories {
	[id: string]: boolean;
}

export enum WorkspaceState {
	BranchComparisons = 'gitlens:branch:comparisons',
	DefaultRemote = 'gitlens:remote:default',
	PinnedComparisons = 'gitlens:pinned:comparisons',
	StarredBranches = 'gitlens:starred:branches',
	StarredRepositories = 'gitlens:starred:repositories',
	ViewsCompareKeepResults = 'gitlens:views:compare:keepResults',
	ViewsRepositoriesAutoRefresh = 'gitlens:views:repositories:autoRefresh',
	ViewsSearchKeepResults = 'gitlens:views:search:keepResults',
}
