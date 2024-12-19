import { context, getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils.js'
import { composePaginateRest, paginateRest } from '@octokit/plugin-paginate-rest'
import Day, { Dayjs } from 'dayjs'
import { logger } from './Logger.js'
import { BranchAndCommit, CloseIssueInput, CreateIssueInput, FlaggedBranch } from './Types.js'

function getFlaggedBranchIssueTitle(branchName: string) {
  return `The branch \`${branchName}\` has been flagged for deletion`
}

const StandardDateFormat = 'YYYY-MM-DD HH:mm:ssZ[Z]'

/**
 * A class with a few utility methods that simplify interacting with the GitHub REST API and the
 * data it returns.
 */
export class GitHubUtil {
  private gh: InstanceType<typeof GitHub>

  /**
   * Create a new instance of the {@link GitHub} class with the given {@link token} and creates a
   * new instance of the `Octokit` class with the {@link paginateRest} and
   * {@link composePaginateRest} plugins.
   *
   * @param token The GitHub token to use for authentication.
   */
  public constructor(token: string) {
    this.gh = getOctokit(token, paginateRest, composePaginateRest)
  }

  /**
   * Retrieves all of the repositories under the given `username`.
   *
   * @param username The name of the user.
   *
   * @returns All the repositories under the given `username`.
   */
  public async getUserRepos(username: string) {
    try {
      const res = await this.gh.paginate('GET /users/{username}/repos', { username, type: 'owner' })

      if (res.length === 0) {
        logger.error(`res: ${JSON.stringify(res, null, 2)}`, `GitHubUtil#getUserRepos`)

        throw new Error('Invalid response from GitHub')
      } else return res
    } catch (error) {
      logger.error(
        `Error caught when getting repos for user ${username}:`,
        `GitHubUtil#getUserRepos`,
      )
      logger.error(error)

      return undefined
    }
  }

  /**
   * Retrieves all of the repositories under the given `org`.
   *
   * @param org The name of the organization.
   *
   * @returns All the repositories under the given `org`.
   */
  public async getOrgRepos(org: string) {
    try {
      const res = await this.gh.paginate('GET /orgs/{org}/repos', { org, type: 'all' })

      if (res.length === 0) {
        logger.error(
          `No repos found for org ${org}: ${JSON.stringify(res, null, 2)}`,
          `GitHubUtil#getOrgRepos`,
        )

        return undefined
      } else return res
    } catch (error) {
      logger.error(`Error caught when getting repos for org ${org}:`, `GitHubUtil#getOrgRepos`)
      logger.error(error)

      return undefined
    }
  }

  /**
   * Retrieves all of the repositories under a given owner, either an organization or a user, and
   * returns them via a Promise.
   *
   * @param owner The owner of the repository.
   * @param ownerType The type of the owner. Either 'org' or 'user'.
   *
   * @returns All the repositories under the given `owner`.
   */
  public async getRepos(owner: string, ownerType: 'org' | 'user' = 'org') {
    try {
      switch (ownerType) {
        case 'org':
          return await this.getOrgRepos(owner)
        case 'user':
          return await this.getUserRepos(owner)
      }
    } catch (error) {
      logger.error(
        `Error caught when getting repos for ${ownerType} ${owner}:`,
        `GitHubUtil#getRepos`,
      )
      logger.error(error)

      return undefined
    }
  }

  /**
   * Retrieve all the branches present in a repository, along with their last commit so we have age
   * information.
   *
   * @param owner The owner of the repository.
   * @param repo The name of the repository.
   */
  public async getBranchesAndLatestCommit(owner: string, repo: string) {
    const branchesAndCommits: BranchAndCommit[] = []

    try {
      const response = await this.gh.paginate('GET /repos/{owner}/{repo}/branches', { owner, repo })

      if (response.length === 0) {
        logger.info(`${owner}/${repo} is an empty repository.`, `GitHubUtil#getBranches`)

        return undefined
      }

      for (const branch of response) {
        // const commit = await this.gh.repos.getCommit({ owner, repo, ref: branch.commit.sha })
        const commit = await this.gh.request('GET /repos/{owner}/{repo}/commits/{ref}', {
          owner,
          repo,
          ref: branch.commit.sha,
        })

        branchesAndCommits.push({ branch: branch, commit: commit.data })
      }
    } catch (error) {
      logger.error(`Error caught when getting branches for repo ${repo}:`, `GitHubUtil#getBranches`)
      logger.error(error)
    }

    return branchesAndCommits
  }

  /**
   * Tries to find an issue for the flagged branch.
   *
   * @param flaggedBranch The flagged branch to find an issue for.
   */
  public async findFlaggedBranchIssue(flaggedBranch: FlaggedBranch) {
    try {
      const issues = await this.gh.paginate('GET /repos/{owner}/{repo}/issues', {
        owner: flaggedBranch.repo.owner,
        repo: flaggedBranch.repo.repo,
        labels: 'stale-branch',
        state: 'open',
      })

      if (issues.length > 0) {
        logger.info(
          `Found ${issues.length} stale-branch issues for ${flaggedBranch.branchName}.`,
          `GitHubUtil#findFlaggedBranchIssue`,
        )

        for (const issue of issues) {
          if (issue.title === getFlaggedBranchIssueTitle(flaggedBranch.branchName)) {
            logger.info(
              `Found issue for flaggedBranch: ${issue.title}`,
              `GitHubUtil#findFlaggedBranchIssue`,
            )
            logger.info(`Issue body: ${issue.body}`, `GitHubUtil#findFlaggedBranchIssue`)

            return issue
          }
        }
      } else {
        logger.success(
          `No stale-branch issues for ${flaggedBranch.branchName}.`,
          `GitHubUtil#findFlaggedBranchIssue`,
        )
      }
    } catch (error) {
      logger.error(`Error caught when getting issue:`, `GitHubUtil#findFlaggedBranchIssue`)
      logger.error(error)
    }
  }

  public async getDefaultBranch(repo?: typeof context.repo) {
    try {
      const { data } = await this.gh.rest.repos.get({
        owner: repo?.owner || context.repo.owner,
        repo: repo?.repo || context.repo.repo,
      })

      return data.default_branch
    } catch (error) {
      logger.error('Error caught when getting default branch:', 'GitHubUtil#getDefaultBranch')
      logger.error(error)

      return undefined
    }
  }

  /**
   * Retrieves an array of all the branches in a repository that have not received a commit since
   * the given `cutoffDate` and are flagged for deletion.
   *
   * @param cutoffDate The date to use as the cutoff for flagging branches.
   *
   * @returns An array of branches that have been flagged for deletion.
   */
  public async getFlaggedBranches(cutoffDate: Dayjs, ignoredBranches: string[]) {
    const flaggedBranches: FlaggedBranch[] = []

    try {
      const branchesAndCommits = await this.getBranchesAndLatestCommit(
        context.repo.owner,
        context.repo.repo,
      )

      if (branchesAndCommits && branchesAndCommits.length > 0) {
        logger.debug(
          `${branchesAndCommits.length} branches found.`,
          'GitHubUtil#getFlaggedBranches',
        )

        for (const { branch, commit } of branchesAndCommits) {
          logger.debug(`Processing branch: ${branch.name}`, 'GitHubUtil#getFlaggedBranches')

          // Verify the branch is not protected.
          if (branch.protected) {
            logger.info(
              `Skipping protected branch: ${branch.name}`,
              'GitHubUtil#getFlaggedBranches',
            )

            continue
          }

          // Verify the branch is not the default branch.
          if (branch.name === (await this.getDefaultBranch())) {
            logger.info(`Skipping default branch: ${branch.name}`, 'GitHubUtil#getFlaggedBranches')

            continue
          }

          // Verify the branch is not in the ignored branches list.
          if (ignoredBranches.includes(branch.name)) {
          logger.info(`Skipping ignored branch: ${branch.name}`, 'GitHubUtil#getFlaggedBranches')

          continue
          }

          const lastCommitDate = Day(commit.commit.committer?.date)

          // Verify the `lastCommitDate` is valid and after the `cutoffDate`.
          if (lastCommitDate.isValid() && cutoffDate.isAfter(lastCommitDate)) {
            logger.success(`Found a stale branch: ${branch.name}`, 'GitHubUtil#getFlaggedBranches')
            logger.success(
              `Last commit date: ${lastCommitDate.format('YYYY-MM-DD')}`,
              'GitHubUtil#getFlaggedBranches',
            )
            logger.success(
              `Cutoff date: ${cutoffDate.format('YYYY-MM-DD')}`,
              'GitHubUtil#getFlaggedBranches',
            )

            flaggedBranches.push({
              repo: context.repo,
              branchName: branch.name,
              lastCommit: commit,
            })
          }
        }
      }
    } catch (error) {
      logger.error(
        'An error occurred while getting flagged branches:',
        'GitHubUtil#getFlaggedBranches',
      )
      logger.error(error)
    }

    return flaggedBranches
  }

  /**
   * Creates a new issue for the flagged branch, indicating it's been marked for deletion. This is
   * our primary mechanism for notifying the owners of the repository that a branch is set to be
   * deleted.
   *
   * @param input An object of input values used to create the issue.
   *
   * @returns The response from the GitHub API when creating the issue.
   */
  public async createIssue({ branch, cutoffDate, labels }: CreateIssueInput) {
    try {
      const newIssueBody: string[] = [
        '# Stale Branch Deletion Notice',
        '\n',
        `The branch [\`${branch.branchName}\`][0] has been flagged for deletion by the [O11y-Stale-Branch-POC Action][1] due to a lack of activity.`,
        '\n',
        '## Further Details',
        '\n',
        `- Will be deleted after: ${cutoffDate.format(StandardDateFormat)}.`,
        `- Branch URL: https://github.com/${branch.repo.owner}/${branch.repo.repo}/tree/${branch.branchName}`,
        `- Last commit by: ${branch.lastCommit.commit.committer?.name || 'Unknown'} <${
          branch.lastCommit.commit.committer?.email || 'Unknown'
        }>`,
        `- Last commit on: ${Day(branch.lastCommit.commit.committer?.date).format(
          StandardDateFormat,
        )}.`,
        `- Last commit URL: ${branch.lastCommit.html_url}`,
        '\n',
        `[0]: https://github.com/${branch.repo.owner}/${branch.repo.repo}/tree/${branch.branchName}`,
        `[1]: https://github.com/liatrio/O11y-Stale-Branch-POC`,
      ]

      return this.gh.rest.issues.create({
        owner: branch.repo.owner,
        repo: branch.repo.repo,
        title: getFlaggedBranchIssueTitle(branch.branchName),
        body: newIssueBody.join('\n'),
        labels,
      })
    } catch (error) {
      logger.error('Error caught when creating issue:', 'GitHubUtil#createIssue')
      logger.error(error)
    }

    return undefined
  }

  /**
   * Closes the issue with the given `issueNumber` in the given `repo`.
   *
   * @param issueNumber The number of the issue to close.
   * @param repo The repository where the issue is located.
   *
   * @returns The response from the GitHub API when closing the issue.
   */
  public async closeIssue({ issueNumber, repo, message }: CloseIssueInput) {
    try {
      await this.gh.rest.issues.createComment({
        body: `${message || 'Closed by stale-branch-action'}`,
        issue_number: issueNumber,
        owner: repo.owner,
        repo: repo.repo,
      })

      return this.gh.rest.issues.update({
        issue_number: issueNumber,
        state: 'closed',
        owner: repo.owner,
        repo: repo.repo,
        state_reason: 'completed',
      })
    } catch (error) {
      logger.error('Error caught when closing issue:', 'GitHubUtil#closeIssue')
      logger.error(error)
    }
  }

  /**
   * Deletes the given branch from the repository.
   *
   * @param branch The branch to delete.
   */
  public async deleteBranch({ branchName, repo }: FlaggedBranch) {
    try {
      return this.gh.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
        owner: repo.owner,
        repo: repo.repo,
        ref: `heads/${branchName}`,
      })
    } catch (error) {
      logger.error('Error caught when deleting branch:', 'GitHubUtil#deleteBranch')
      logger.error(error)
    }
  }
}
