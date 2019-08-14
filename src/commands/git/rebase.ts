'use strict';
import { QuickPickItem } from 'vscode';
import { Container } from '../../container';
import { GitBranch, GitTag, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { getBranchesAndOrTags, QuickCommandBase, QuickInputStep, QuickPickStep, StepState } from '../quickCommand';
import {
    BackOrCancelQuickPickItem,
    BranchQuickPickItem,
    RepositoryQuickPickItem,
    TagQuickPickItem
} from '../../quickpicks';
import { Strings } from '../../system';
import { runGitCommandInTerminal } from '../../terminal';
import { Logger } from '../../logger';

interface State {
    repo: Repository;
    destination: GitBranch;
    source: GitBranch | GitTag;
    flags: string[];
}

export class RebaseGitCommand extends QuickCommandBase<State> {
    constructor() {
        super('rebase', 'Rebase', { description: 'via Terminal' });
    }

    execute(state: State) {
        runGitCommandInTerminal('rebase', [...state.flags, state.source.ref].join(' '), state.repo.path, true);
    }

    protected async *steps(): AsyncIterableIterator<QuickPickStep | QuickInputStep> {
        const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
        let oneRepo = false;

        while (true) {
            try {
                if (state.repo === undefined || state.counter < 1) {
                    const repos = [...(await Container.git.getOrderedRepositories())];

                    if (repos.length === 1) {
                        oneRepo = true;
                        state.counter++;
                        state.repo = repos[0];
                    }
                    else {
                        const active = state.repo ? state.repo : await Container.git.getActiveRepository();

                        const step = this.createPickStep<RepositoryQuickPickItem>({
                            title: this.title,
                            placeholder: 'Choose a repository',
                            items: await Promise.all(
                                repos.map(r =>
                                    RepositoryQuickPickItem.create(r, r.id === (active && active.id), {
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

                        state.repo = selection[0].item;
                    }
                }

                state.destination = await state.repo.getBranch();
                if (state.destination === undefined) break;

                if (state.source === undefined || state.counter < 2) {
                    const destId = state.destination.id;

                    const step = this.createPickStep<BranchQuickPickItem | TagQuickPickItem>({
                        title: `${this.title} ${state.destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repo.formattedName
                        }`,
                        placeholder: `Choose a branch or tag to rebase ${state.destination.name} with`,
                        items: await getBranchesAndOrTags(state.repo, true, {
                            filterBranches: b => b.id !== destId,
                            picked: state.source && state.source.ref
                        })
                    });
                    const selection = yield step;

                    if (!this.canMoveNext(step, state, selection)) {
                        if (oneRepo) {
                            break;
                        }
                        continue;
                    }

                    state.source = selection[0].item;
                }

                const count =
                    (await Container.git.getCommitCount(state.repo.path, [
                        `${state.destination.name}..${state.source.name}`
                    ])) || 0;
                if (count === 0) {
                    const step = this.createConfirmStep(
                        `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
                        [],
                        {
                            cancel: BackOrCancelQuickPickItem.create(true, true, {
                                label: `Cancel ${this.title}`,
                                detail: `${state.destination.name} is up to date with ${state.source.name}`
                            })
                        }
                    );

                    yield step;
                    break;
                }

                const step = this.createConfirmStep<QuickPickItem & { item: string[] }>(
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
                    [
                        {
                            label: this.title,
                            description: `${state.destination.name} with ${state.source.name}`,
                            detail: `Will update ${state.destination.name} by applying ${Strings.pluralize(
                                'commit',
                                count
                            )} on top of ${state.source.name}`,
                            item: []
                        },
                        {
                            label: `Interactive ${this.title}`,
                            description: `--interactive ${state.destination.name} with ${state.source.name}`,
                            detail: `Will interactively update ${
                                state.destination.name
                            } by applying ${Strings.pluralize('commit', count)} on top of ${state.source.name}`,
                            item: ['--interactive']
                        }
                    ]
                );
                const selection = yield step;

                if (!this.canMoveNext(step, state, selection)) {
                    continue;
                }

                state.flags = selection[0].item;

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
