'use strict';
/* eslint-disable no-loop-func */
import { Container } from '../../container';
import { GitBranch, GitLogCommit, GitReference, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { Iterables, Strings } from '../../system';
import { getBranchesAndOrTags, QuickCommandBase, QuickInputStep, QuickPickStep, StepState } from '../quickCommand';
import {
    BranchQuickPickItem,
    CommitQuickPickItem,
    Directive,
    DirectiveQuickPickItem,
    RefQuickPickItem,
    RepositoryQuickPickItem
} from '../../quickpicks';
import { runGitCommandInTerminal } from '../../terminal';
import { Logger } from '../../logger';

interface State {
    repo: Repository;
    destination: GitBranch;
    source: GitBranch | GitReference;
    commits?: GitLogCommit[];
}

export class CherryPickGitCommand extends QuickCommandBase<State> {
    constructor() {
        super('cherry-pick', 'cherry-pick', 'Cherry Pick', false, { description: 'via Terminal' });
    }

    execute(state: State) {
        if (state.commits !== undefined) {
            // Ensure the commits are ordered with the oldest first
            state.commits.sort((a, b) => a.date.getTime() - b.date.getTime());
            runGitCommandInTerminal('cherry-pick', state.commits.map(c => c.sha).join(' '), state.repo.path, true);
        }

        runGitCommandInTerminal('cherry-pick', state.source.ref, state.repo.path, true);
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

                    const step = this.createPickStep<BranchQuickPickItem | RefQuickPickItem>({
                        title: `${this.title} into ${state.destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repo.formattedName
                        }`,
                        placeholder: `Choose a branch or tag to cherry-pick from${GlyphChars.Space.repeat(
                            3
                        )}(select or enter a reference)`,
                        matchOnDescription: true,
                        items: await getBranchesAndOrTags(state.repo, true, {
                            filterBranches: b => b.id !== destId
                        }),
                        onValidateValue: async (quickpick, value) => {
                            if (!(await Container.git.validateReference(state.repo!.path, value))) return false;

                            quickpick.items = [RefQuickPickItem.create(value, true, { ref: true })];
                            return true;
                        }
                    });
                    const selection = yield step;

                    if (!this.canMoveNext(step, state, selection)) {
                        if (oneRepo) {
                            break;
                        }

                        continue;
                    }

                    if (GitBranch.is(state.source)) {
                        state.source = selection[0].item;
                    }
                    else {
                        state.source = selection[0].item;
                        state.counter++;
                    }
                }

                if (GitBranch.is(state.source) && (state.commits === undefined || state.counter < 3)) {
                    const log = await Container.git.getLog(state.repo.path, {
                        ref: `${state.destination.ref}..${state.source.ref}`,
                        merges: false
                    });

                    const step = this.createPickStep<CommitQuickPickItem>({
                        title: `${this.title} onto ${state.destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repo.formattedName
                        }`,
                        multiselect: log !== undefined,
                        placeholder:
                            log === undefined
                                ? `${state.source.name} has no pickable commits`
                                : `Choose commits to cherry-pick onto ${state.destination.name}`,
                        matchOnDescription: true,
                        items:
                            log === undefined
                                ? [
                                      DirectiveQuickPickItem.create(Directive.Back, true),
                                      DirectiveQuickPickItem.create(Directive.Cancel)
                                  ]
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
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.formattedName}`,
                    [
                        state.commits !== undefined
                            ? {
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
                            : {
                                  label: this.title,
                                  description: `${state.source.name} onto ${state.destination.name}`,
                                  detail: `Will apply commit ${state.source.name} onto ${state.destination.name}`
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
                Logger.error(ex, this.title);

                throw ex;
            }
        }
    }
}
