import type { TextEditor, TextEditorEdit, Uri } from 'vscode';
import type { AnnotationContext } from '../annotations/annotationProvider';
import type { ChangesAnnotationContext } from '../annotations/gutterChangesAnnotationProvider';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { getEditorIfVisible, isTrackableTextEditor } from '../system/utils';
import { ActiveEditorCommand, EditorCommand } from './base';

@command()
export class ClearFileAnnotationsCommand extends EditorCommand {
	constructor(private readonly container: Container) {
		super([Commands.ClearFileAnnotations, Commands.ComputingFileAnnotations]);
	}

	async execute(editor: TextEditor | undefined, _edit: TextEditorEdit, uri?: Uri): Promise<void> {
		editor = getValidEditor(editor, uri);
		if (editor == null) return;

		try {
			await this.container.fileAnnotations.clear(editor);
		} catch (ex) {
			Logger.error(ex, 'ClearFileAnnotationsCommand');
			void showGenericErrorMessage('Unable to clear file annotations');
		}
	}
}

export interface ToggleFileBlameAnnotationCommandArgs {
	type: 'blame';
	context?: AnnotationContext;
	on?: boolean;
}

export interface ToggleFileChangesAnnotationCommandArgs {
	type: 'changes';
	context?: ChangesAnnotationContext;
	on?: boolean;
}

export interface ToggleFileHeatmapAnnotationCommandArgs {
	type: 'heatmap';
	context?: AnnotationContext;
	on?: boolean;
}

export type ToggleFileAnnotationCommandArgs =
	| ToggleFileBlameAnnotationCommandArgs
	| ToggleFileChangesAnnotationCommandArgs
	| ToggleFileHeatmapAnnotationCommandArgs;

@command()
export class ToggleFileBlameCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([Commands.ToggleFileBlame, Commands.ToggleFileBlameInDiffLeft, Commands.ToggleFileBlameInDiffRight]);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileBlameAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileBlameAnnotationCommandArgs>(this.container, editor, uri, {
			...args,
			type: 'blame',
		});
	}
}

@command()
export class ToggleFileChangesCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.ToggleFileChanges);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileChangesAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileChangesAnnotationCommandArgs>(this.container, editor, uri, {
			...args,
			type: 'changes',
		});
	}
}

@command()
export class ToggleFileHeatmapCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.ToggleFileHeatmap,
			Commands.ToggleFileHeatmapInDiffLeft,
			Commands.ToggleFileHeatmapInDiffRight,
		]);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileHeatmapAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileHeatmapAnnotationCommandArgs>(this.container, editor, uri, {
			...args,
			type: 'heatmap',
		});
	}
}

async function toggleFileAnnotations<TArgs extends ToggleFileAnnotationCommandArgs>(
	container: Container,
	editor: TextEditor | undefined,
	uri: Uri | undefined,
	args: TArgs,
): Promise<void> {
	editor = getValidEditor(editor, uri);

	try {
		args = { type: 'blame', ...(args as any) };

		void (await container.fileAnnotations.toggle(
			editor,
			args.type,
			{
				selection: args.context?.selection ?? { line: editor?.selection.active.line },
				...args.context,
			},
			args.on,
		));
	} catch (ex) {
		Logger.error(ex, 'ToggleFileAnnotationsCommand');
		void showGenericErrorMessage(`Unable to toggle file ${args.type} annotations`);
	}
}

function getValidEditor(editor: TextEditor | undefined, uri: Uri | undefined) {
	// Handle the case where we are focused on a non-editor editor (output, debug console) or focused on another editor, but executing an action on another editor
	if (editor != null && !isTrackableTextEditor(editor)) {
		editor = undefined;
	}

	if (uri != null && (editor == null || editor.document.uri.toString() !== uri.toString())) {
		const e = getEditorIfVisible(uri);
		if (e != null) {
			editor = e;
		}
	}

	return editor;
}
