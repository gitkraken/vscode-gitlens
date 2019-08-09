'use strict';
/* eslint-disable no-loop-func */
import { Container } from '../../container';
import { GitBranch, GitLogCommit, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { Iterables, Strings } from '../../system';
import {
    CommandAbortError,
    getBranchesAndOrTags,
    QuickCommandBase,
    QuickInputStep,
    QuickPickStep,
    StepState
} from './quickCommand';
import { BranchQuickPickItem, CommitQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { runGitCommandInTerminal } from '../../terminal';

interface State {
    repo: Repository;
    destination: GitBranch;
    source: GitBranch;
    commits: GitLogCommit[];
}

export class CherryPickQuickCommand extends QuickCommandBase<State> {
    constructor() {
        super('cherry-pick', 'Cherry Pick', { description: 'via Terminal' });
    }

    execute(state: State) {
        // Ensure the commits are ordered with the oldest first
        state.commits.sort((a, b) => a.date.getTime() - b.date.getTime());
        runGitCommandInTerminal('cherry-pick', state.commits.map(c => c.sha).join(' '), state.repo.path, true);
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

                    const step = this.createPickStep<BranchQuickPickItem>({
                        title: `${this.title} into ${state.destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repo.name
                        }`,
                        placeholder: 'Choose a branch or tag to cherry-pick from',
                        items: await getBranchesAndOrTags(state.repo, true, {
                            filterBranches: b => b.id !== destId
                        })
                        // onDidAccept: (quickpick): Promise<boolean> => {
                        //     const ref = quickpick.value.trim();
                        //     if (ref.length === 0) return Promise.resolve(false);

                        //     return Container.git.validateReference(state.repo!.path, ref);
                        // }
                    });
                    const selection = yield step;

                    if (!this.canMoveNext(step, state, selection)) {
                        if (oneRepo) {
                            break;
                        }

                        continue;
                    }

                    // TODO: Allow pasting in commit id
                    // if (typeof selection === 'string') {

                    // }
                    // else {
                    state.source = selection[0].item;
                    // }
                }

                if (state.commits === undefined || state.counter < 3) {
                    const log = await Container.git.getLog(state.repo.path, {
                        ref: `${state.destination.ref}..${state.source.ref}`,
                        merges: false
                    });

                    const step = this.createPickStep<CommitQuickPickItem>({
                        title: `${this.title} onto ${state.destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repo.name
                        }`,
                        multiselect: log !== undefined,
                        placeholder:
                            log === undefined
                                ? `${state.source.name} has no pickable commits`
                                : `Choose commits to cherry-pick onto ${state.destination.name}`,
                        items:
                            log === undefined
                                ? []
                                : [
                                      ...Iterables.map(log.commits.values(), commit =>
                                          CommitQuickPickItem.create(
                                              commit,
                                              state.commits ? state.commits.some(c => c.sha === commit.sha) : undefined,
                                              { compact: true }
                                          )
                                      )
                                  ]
                    });
                    const selection = yield step;

                    if (!this.canMoveNext(step, state, selection)) {
                        continue;
                    }

                    state.commits = selection.map(i => i.item);
                }

                const step = this.createConfirmStep(
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.name}`,
                    [
                        {
                            label: this.title,
                            description: `${
                                state.commits.length === 1
                                    ? state.commits[0].shortSha
                                    : `${state.commits.length} commits`
                            } onto ${state.destination.name}`,
                            detail: `Will apply ${
                                state.commits.length === 1
                                    ? `commit ${state.commits[0].shortSha}`
                                    : `${state.commits.length} commits`
                            } onto ${state.destination.name}`
                        }
                    ]
                );
                const selection = yield step;

                if (!this.canMoveNext(step, state, selection)) {
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
