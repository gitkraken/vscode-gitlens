'use strict';
import { Container } from '../../container';
import { Repository } from '../../git/gitService';
import { CommandAbortError, QuickCommandBase, QuickPickStep } from './quickCommand';
import { RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { GlyphChars } from '../../constants';

interface State {
    repos: Repository[];
}

export class PushQuickCommand extends QuickCommandBase {
    constructor() {
        super('push', 'Push');
    }

    execute(state: State) {
        return Container.git.pushAll(state.repos);
    }

    async *steps(): AsyncIterableIterator<QuickPickStep> {
        const state: Partial<State> & { counter: number } = { counter: 0 };
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
                        const step = this.createStep<RepositoryQuickPickItem>({
                            multiselect: true,
                            title: this.title,
                            placeholder: 'Choose repositories',
                            items: await Promise.all(
                                repos.map(r =>
                                    RepositoryQuickPickItem.create(r, undefined, {
                                        branch: true,
                                        fetched: true,
                                        status: true
                                    })
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

                const step = this.createConfirmStep(
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                        state.repos.length === 1 ? state.repos[0].formattedName : `${state.repos.length} repositories`
                    }`,
                    [
                        {
                            label: this.title,
                            description: '',
                            detail: `Will push ${
                                state.repos.length === 1
                                    ? state.repos[0].formattedName
                                    : `${state.repos.length} repositories`
                            }`
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
