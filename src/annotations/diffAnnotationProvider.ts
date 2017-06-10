'use strict';
import { DecorationOptions, ExtensionContext, Position, Range, TextEditor, TextEditorDecorationType } from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { GitService, GitUri } from '../gitService';
import { WhitespaceController } from './whitespaceController';

export class DiffAnnotationProvider extends AnnotationProviderBase {

    constructor(context: ExtensionContext, editor: TextEditor, decoration: TextEditorDecorationType, highlightDecoration: TextEditorDecorationType | undefined, whitespaceController: WhitespaceController | undefined, private git: GitService, private uri: GitUri) {
        super(context, editor, decoration, highlightDecoration, whitespaceController);
    }

    async provideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        // let sha1: string | undefined = undefined;
        // let sha2: string | undefined = undefined;
        // if (shaOrLine === undefined) {
        //     const commit = await this.git.getLogCommit(this.uri.repoPath, this.uri.fsPath, { previous: true });
        //     if (commit === undefined) return false;

        //     sha1 = commit.previousSha;
        // }
        // else if (typeof shaOrLine === 'string') {
        //     sha1 = shaOrLine;
        // }
        // else {
        //     const blame = await this.git.getBlameForLine(this.uri, shaOrLine);
        //     if (blame === undefined) return false;

        //     sha1 = blame.commit.previousSha;
        //     sha2 = blame.commit.sha;
        // }

        // if (sha1 === undefined) return false;

        const commit = await this.git.getLogCommit(this.uri.repoPath, this.uri.fsPath, { previous: true });
        if (commit === undefined) return false;

        const diff = await this.git.getDiffForFile(this.uri, commit.previousSha);
        if (diff === undefined) return false;

        const decorators: DecorationOptions[] = [];

        for (const chunk of diff.chunks) {
            let count = chunk.currentPosition.start - 2;
            for (const change of chunk.current) {
                if (change === undefined) continue;

                count++;

                if (change.state === 'unchanged') continue;

                decorators.push({
                    range: new Range(new Position(count, 0), new Position(count, 0))
                } as DecorationOptions);
            }
        }

        this.editor.setDecorations(this.decoration, decorators);

        return true;
    }

    async selection(shaOrLine?: string | number): Promise<void> {
    }

    async validate(): Promise<boolean> {
        return true;
    }
}