'use strict';
import { Objects } from '../system';
import { ExtensionContext } from 'vscode';
import { Command, Commands } from './common';
import { SuppressedKeys } from '../messages';

export class ResetSuppressedWarningsCommand extends Command {

    constructor(private context: ExtensionContext) {
        super(Commands.ResetSuppressedWarnings);
    }

    async execute() {
        for (const key of Objects.values(SuppressedKeys)) {
            await this.context.globalState.update(key, undefined);
        }
    }
}