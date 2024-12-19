import * as core from '@actions/core'
import Day, { Dayjs, ManipulateType } from 'dayjs'
import { GitHubUtil } from './GitHubUtil.js'
import { logger } from './Logger.js'
import { ActionsInput } from './Types.js'

/**
 * Creates an instance of `Dayjs` with the value of the input with the given name, in the format of
 * `<value> <unit>`, and performs the given operation on the date. For example, if the input
 * `stale-branch-age` has a value of `3 days` and the operation is `past`, the date will be 3 days
 * in the past.
 *
 * @param inputName The name of the input to get the value for.
 * @param direction The direction to manipulate the date.
 *
 * @returns A `Dayjs` instance with the date value.
 */
function getInputAsDate(inputName: string, direction: 'future' | 'past'): Dayjs {
  const inputValue = core.getInput(inputName).split(' ')

  if (inputValue.length !== 2) {
    core.setFailed(`Invalid ${inputName} input. Must be in the format of "<value> <unit>".`)

    throw new Error(`The ${inputName} input is in an invalid format.`)
  }

  const inputNumber = Number(inputValue[0])
  const inputUnit = inputValue[1] as ManipulateType

  switch (direction) {
    case 'future':
      return Day().add(inputNumber, inputUnit)
    case 'past':
      return Day().subtract(inputNumber, inputUnit)
  }
}

/**
 * Gets the input values from the GitHub Action and returns them as an object.
 *
 * @returns An object containing the input values for the GitHub Action.
 */
function getActionsInput(): ActionsInput {
  const token = core.getInput('github-token')
  const branchCutoffDate = getInputAsDate('stale-branch-age', 'past')
  const issueCutoffDate = getInputAsDate('stale-branch-issue-age', 'past')
  const ignoredBranches = core.getInput('ignored-branches').split(',').map(branch => branch.trim())

  return { branchCutoffDate, issueCutoffDate, token, ignoredBranches }
}

async function run() {
  const { branchCutoffDate, issueCutoffDate, token, ignoredBranches } = getActionsInput()

  const gh = new GitHubUtil(token)

  const flaggedBranches = await gh.getFlaggedBranches(branchCutoffDate, ignoredBranches)

  core.debug(`Found ${flaggedBranches.length || 0} branches that are flagged for deletion.`)

  for (const branch of flaggedBranches) {
    core.debug(`Processing flagged branch: ${branch.branchName}`)

    const issue = await gh.findFlaggedBranchIssue(branch)

    if (issue) {
      core.debug(`Found deletion issue: ${issue.title}; ${issue.html_url}`)

      // Check if the issue has been open longer than the required amount of time.
      if (Day().isAfter(issueCutoffDate)) {
        const delRes = await gh.deleteBranch(branch)

        logger.success(`Deleted flagged branch: ${branch.branchName}`, 'index#run')

        const issueDelRes = await gh.closeIssue({ issueNumber: issue.number, repo: branch.repo })

        logger.success(
          `Closed issue for flagged branch: ${issueDelRes?.data?.title || 'Unknown'}`,
          'index#run',
        )

        logger.debug('Branch deletion response:')
        logger.success(JSON.stringify(delRes?.data, null, 2), 'index#run')

        logger.debug('Issue deletion response:')
        logger.success(JSON.stringify(issueDelRes?.data, null, 2), 'index#run')
      } else {
        logger.info(
          `Issue has not been open for required amount of time. Skipping branch deletion: ${branch.branchName}`,
          'index#run',
        )
      }
    } else {
      core.debug('No deletion issue found for flagged branch.')

      const newIssue = await gh.createIssue({
        branch,
        cutoffDate: issueCutoffDate,
        labels: ['stale-branch'],
      })

      logger.success(
        `Created issue for flagged branch: ${newIssue?.data?.title || 'Unknown'}`,
        'index#run',
      )
      logger.success(`You can view the issue at: ${newIssue?.data?.html_url}`, 'index#run')
    }
  }

  logger.success('Action completed successfully!', 'index#run')
}

run().catch(err => {
  if (err instanceof Error) core.setFailed(err.message)

  core.setFailed('An error occurred, check logs for more information.')
})
