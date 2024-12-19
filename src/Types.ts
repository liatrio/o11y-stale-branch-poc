import { context } from '@actions/github'
import { type Endpoints } from '@octokit/types'
import { Dayjs, ManipulateType } from 'dayjs'

/**
 * An object containing the data available as input from the GitHub Action.
 *
 * _NOTE: This can likely be deleted but I'm keeping it here just in case it's needed later._
 */
export type ActionsInput = {
  /**
   * The date that is the cutoff for when a branch is considered stale. Any branch that has not had
   * any activity (commits) since this date is considered stale and will be flagged for deletion.
   */
  branchCutoffDate: Dayjs

  /**
   * When a branch is flagged for deletion and an issue is created to notify the owners, this is the
   * date that is used to determine when the branch can be deleted. If the issue has been open for
   * longer than this date, then the branch can be deleted.
   */
  issueCutoffDate: Dayjs

  /** The personal access token used for authenticating with the GitHub API. */
  token: string

  /** The branches not to prune. */
  ignoredBranches: string[]
}

/** An object containing the relevant data for a branch and its last commit. */
export type BranchAndCommit = {
  /** The details available for a branch. */
  branch: BranchResponse

  /** The last commit made to the branch. */
  commit: CommitResponse
}

/** The response from the GitHub API when fetching a branch. */
export type BranchResponse =
  Endpoints['GET /repos/{owner}/{repo}/branches']['response']['data'][number]

/** An object containing the details needed to close an issue. */
export type CloseIssueInput = {
  /** The issue number to close. */
  issueNumber: number

  /** The repo where the issue lives. */
  repo: typeof context.repo

  /**
   * An optional string to use as the closing message. If none is provided, the default message of
   * "Closed by stale-branch-action" will be used.
   */
  message?: string
}

/** The response from the GitHub API when fetching a commit. */
export type CommitResponse =
  Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']

/**
 * An object containing the details needed to create a new issue that a branch has been flagged for
 * deletion.
 */
export type CreateIssueInput = {
  /** The branch that has been flagged for deletion. */
  branch: FlaggedBranch

  /**
   * The date that the issue will need to be open by for the branch to be deleted. For example, if
   * the issue is not closed by this date, then the branch will be deleted the next time the action
   * runs.
   */
  cutoffDate: Dayjs

  /** An optional array of labels to assign to the issue. Default: `['stale-branch']`. */
  labels?: string[]
}

/** An object containing the data needed to create a `Dayjs` instance. */
export type DateInputValues = {
  /** The number of units to subtract or add to the current date. */
  number: number

  /** The unit of time to subtract or add to the current date. */
  unit: ManipulateType
}

/** An object containing the relevant data for a branch that has been flagged for deletion. */
export type FlaggedBranch = {
  /** Details about the repo where the branch lives. */
  repo: typeof context.repo

  /** The name of the branch that has been flagged for deletion. */
  branchName: string

  /** An object containing data about the last commit made to the flagged branch. */
  lastCommit: CommitResponse
}

/** The response from the GitHub API when fetching issues. */
export type IssuesResponse =
  Endpoints['GET /repos/{owner}/{repo}/issues']['response']['data'][number]

/** The response from the GitHub API when fetching repositories. */
export type ReposResponse = Endpoints['GET /orgs/{org}/repos']['response']['data'][number]
