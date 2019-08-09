'use strict';
import { QuickPickItem } from 'vscode';
import { Container } from '../../container';
import { Repository } from '../../git/gitService';
import { CommandAbortError, QuickCommandBase, QuickInputStep, QuickPickStep, StepState } from './quickCommand';
import { RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';

interface State {
    repos: Repository[];
    flags: string[];
}

export interface CommandArgs {
    readonly command: 'pull';
    state?: Partial<State>;

    skipConfirmation?: boolean;
}

export class PullQuickCommand extends QuickCommandBase<State> {
    constructor(args?: CommandArgs) {
        super('pull', 'Pull');

        if (args === undefined || args.state === undefined) return;

        let counter = 0;
        if (args.state.repos !== undefined && args.state.repos.length !== 0) {
            counter++;
        }

        if (
            args.skipConfirmation === undefined &&
            Container.config.gitCommands.skipConfirmations.includes(this.label)
        ) {
            args.skipConfirmation = true;
        }

        this._initialState = {
            counter: counter,
            skipConfirmation: counter > 0 && args.skipConfirmation,
            ...args.state
        };
    }

    execute(state: State) {
        return Container.git.pullAll(state.repos, { rebase: state.flags.includes('--rebase') });
    }

    protected async *steps(): AsyncIterableIterator<QuickPickStep | QuickInputStep> {
        const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
        let oneRepo = false;

        while (true) {
            try {
                if (state.repos === undefined || state.counter < 1) {
                    const repos = [...(await Container.git.getOrderedRepositories())];

                    if (repos.length === 1) {
                        oneRepo = true;
                        state.counter++;
                        state.repos = [repos[0]];
                    }
                    else {
                        const step = this.createPickStep<RepositoryQuickPickItem>({
                            multiselect: true,
                            title: this.title,
                            placeholder: 'Choose repositories',
                            items: await Promise.all(
                                repos.map(repo =>
                                    RepositoryQuickPickItem.create(
                                        repo,
                                        state.repos ? state.repos.some(r => r.id === repo.id) : undefined,
                                        {
                                            branch: true,
                                            fetched: true,
                                            status: true
                                        }
                                    )
                                )
                            )
                        });
                        const selection = yield step;

                        if (!this.canMoveNext(step, state, selection)) {
                            break;
                        }

                        state.repos = selection.map(i => i.item);
                    }
                }

                const step = this.createConfirmStep<QuickPickItem & { item: string[] }>(
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
                    }`,
                    [
                        {
                            label: this.title,
                            description: '',
                            detail: `Will pull ${
                                state.repos.length === 1
                                    ? state.repos[0].formattedName
                                    : `${state.repos.length} repositories`
                            }`,
                            item: []
                        },
                        {
                            label: `${this.title} with Rebase`,
                            description: '--rebase',
                            detail: `Will pull with rebase ${
                                state.repos.length === 1
                                    ? state.repos[0].formattedName
                                    : `${state.repos.length} repositories`
                            }`,
                            item: ['--rebase']
                        }
                    ]
                );
                const selection = yield step;

                if (!this.canMoveNext(step, state, selection)) {
                    if (oneRepo) {
                        break;
                    }

                    continue;
                }

                state.flags = selection[0].item;

                this.execute(state as State);
                break;
            }
            catch (ex) {
                if (ex instanceof CommandAbortError) break;

                throw ex;
            }
        }
    }
}
