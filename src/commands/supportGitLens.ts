'use strict';
import { env, Uri } from 'vscode';
import { command, Command, Commands } from './common';

@command()
export class SupportGitLensCommand extends Command {
	constructor() {
		super(Commands.SupportGitLens);
	}

	async execute() {
		await env.openExternal(Uri.parse('https://gitlens.amod.io/#sponsor'));
	}
}
