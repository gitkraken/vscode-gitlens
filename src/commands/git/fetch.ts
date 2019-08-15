'use strict';
import { Container } from '../../container';
import { Repository } from '../../git/gitService';
import { QuickCommandBase, QuickInputStep, QuickPickStep, StepState } from '../quickCommand';
import { QuickPickItemPlus, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';

interface State {
    repos: Repository[];
    flags: string[];
}

export interface FetchGitCommandArgs {
    readonly command: 'fetch';
    state?: Partial<State>;

    confirm?: boolean;
}

export class FetchGitCommand extends QuickCommandBase<State> {
    constructor(args?: FetchGitCommandArgs) {
        super('fetch', 'fetch', 'Fetch');

        if (args === undefined || args.state === undefined) return;

        let counter = 0;
        if (args.state.repos !== undefined && args.state.repos.length !== 0) {
            counter++;
        }

        this._initialState = {
            counter: counter,
            confirm: args.confirm,
            ...args.state
        };
    }

    execute(state: State) {
        return Container.git.fetchAll(state.repos, {
            all: state.flags.includes('--all'),
            prune: state.flags.includes('--prune')
        });
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

                if (this.confirm(state.confirm)) {
                    const step = this.createConfirmStep<QuickPickItemPlus<string[]>>(
                        `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repos.length === 1
                                ? state.repos[0].formattedName
                                : `${state.repos.length} repositories`
                        }`,
                        [
                            {
                                label: this.title,
                                description: '',
                                detail: `Will fetch ${
                                    state.repos.length === 1
                                        ? state.repos[0].formattedName
                                        : `${state.repos.length} repositories`
                                }`,
                                item: []
                            },
                            {
                                label: `${this.title} & Prune`,
                                description: '--prune',
                                detail: `Will fetch and prune ${
                                    state.repos.length === 1
                                        ? state.repos[0].formattedName
                                        : `${state.repos.length} repositories`
                                }`,
                                item: ['--prune']
                            },
                            {
                                label: `${this.title} All`,
                                description: '--all',
                                detail: `Will fetch all remotes of ${
                                    state.repos.length === 1
                                        ? state.repos[0].formattedName
                                        : `${state.repos.length} repositories`
                                }`,
                                item: ['--all']
                            },
                            {
                                label: `${this.title} All & Prune`,
                                description: '--all',
                                detail: `Will fetch and prune all remotes of ${
                                    state.repos.length === 1
                                        ? state.repos[0].formattedName
                                        : `${state.repos.length} repositories`
                                }`,
                                item: ['--all', '--prune']
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
                }
                else {
                    state.flags = [];
                }

                this.execute(state as State);
                break;
            }
            catch (ex) {
                Logger.error(ex, this.title);

                throw ex;
            }
        }
    }
}
