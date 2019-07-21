'use strict';
import { QuickPickItem } from 'vscode';
import { Container } from '../../container';
import { GitBranch, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { CommandAbortError, QuickPickStep } from './quickCommand';
import { BranchQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { GitCommandBase } from './gitCommand';
import { runGitCommandInTerminal } from '../../terminal';

interface State {
    repo: Repository;
    destination: GitBranch;
    source: GitBranch;
    flags: string[];
}

export class MergeQuickCommand extends GitCommandBase {
    constructor() {
        super('merge', 'Merge', { description: 'via Terminal' });
    }

    execute(state: State) {
        runGitCommandInTerminal('merge', [...state.flags, state.source.ref].join(' '), state.repo.path, true);
    }

    async *steps(): AsyncIterableIterator<QuickPickStep> {
        const state: Partial<State> & { counter: number } = { counter: 0 };
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

                        const step = this.createStep<RepositoryQuickPickItem>({
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

                    const step = this.createStep<BranchQuickPickItem>({
                        title: `${this.title} into ${state.destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repo.name
                        }`,
                        placeholder: `Choose a branch or tag to merge into ${state.destination.name}`,
                        items: await this.getBranchesAndOrTags(state.repo, true, {
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
                        `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.name}`,
                        [
                            {
                                label: `Cancel ${this.title}`,
                                description: '',
                                detail: `${state.destination.name} is up to date with ${state.source.name}`
                            }
                        ],
                        false
                    );

                    yield step;
                    break;
                }

                const step = this.createConfirmStep<QuickPickItem & { item: string[] }>(
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.name}`,
                    [
                        {
                            label: this.title,
                            description: `${state.source.name} into ${state.destination.name}`,
                            detail: `Will merge ${Strings.pluralize('commit', count)} from ${state.source.name} into ${
                                state.destination.name
                            }`,
                            item: []
                        },
                        {
                            label: `Fast-forward ${this.title}`,
                            description: `--ff-only ${state.source.name} into ${state.destination.name}`,
                            detail: `Will fast-forward merge ${Strings.pluralize('commit', count)} from ${
                                state.source.name
                            } into ${state.destination.name}`,
                            item: ['--ff-only']
                        },
                        {
                            label: `No Fast-forward ${this.title}`,
                            description: `--no-ff ${state.source.name} into ${state.destination.name}`,
                            detail: `Will create a merge commit when merging ${Strings.pluralize(
                                'commit',
                                count
                            )} from ${state.source.name} into ${state.destination.name}`,
                            item: ['--no-ff']
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
                if (ex instanceof CommandAbortError) break;

                throw ex;
            }
        }
    }
}
