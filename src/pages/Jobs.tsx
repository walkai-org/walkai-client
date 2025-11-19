import { useQuery } from '@tanstack/react-query'
import type { JSX, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './Jobs.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

type JobRun = {
  id: number
  status: string
  k8s_job_name: string
  k8s_pod_name: string
  started_at: string | null
  finished_at: string | null
}

type JobRecord = {
  id: number
  image: string
  gpu_profile: string
  submitted_at: string
  created_by_id: number
  latest_run: JobRun | null | undefined
}

const isJobRun = (value: unknown): value is JobRun => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const isNullableString = (input: unknown) => input === null || typeof input === 'string'

  return (
    typeof record.id === 'number' &&
    typeof record.status === 'string' &&
    typeof record.k8s_job_name === 'string' &&
    typeof record.k8s_pod_name === 'string' &&
    isNullableString(record.started_at) &&
    isNullableString(record.finished_at)
  )
}

const isJobRecord = (value: unknown): value is JobRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const maybeLastRun = record.last_run

  const isString = (input: unknown) => typeof input === 'string'

  return (
    typeof record.id === 'number' &&
    isString(record.image) &&
    isString(record.gpu_profile) &&
    isString(record.submitted_at) &&
    typeof record.created_by_id === 'number' &&
    (maybeLastRun === undefined || maybeLastRun === null || isJobRun(maybeLastRun))
  )
}

const fetchJobs = async (): Promise<JobRecord[]> => {
  const response = await fetch(`${API_BASE}/jobs/`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Jobs request failed (${response.status})`)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable jobs response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isJobRecord)) {
    throw new Error('Received malformed jobs response. Please contact support.')
  }

  return payload
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return dateTimeFormatter.format(date)
}

const formatStatusLabel = (status: string): string =>
  status
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Unknown'

const getStatusStyleKey = (status: string): 'running' | 'pending' | 'failed' | 'succeeded' | 'unknown' => {
  const normalized = status.trim().toLowerCase()
  if (normalized.includes('run')) return 'running'
  if (normalized.includes('pend')) return 'pending'
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed'
  if (normalized.includes('succ') || normalized.includes('compl')) return 'succeeded'
  return 'unknown'
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message || 'Something went wrong.' : 'Something went wrong.'

const Jobs = (): JSX.Element => {
  const navigate = useNavigate()

  const jobsQuery = useQuery<JobRecord[], Error>({
    queryKey: ['jobs', 'list'],
    queryFn: fetchJobs,
    staleTime: 10_000,
    refetchInterval: 7_500,
  })

  const jobs = jobsQuery.data ?? []

  const getStatusClassName = (status: string): string => {
    const key = getStatusStyleKey(status)
    const modifier = styles[key] ?? styles.unknown
    return `${styles.statusBadge} ${modifier}`.trim()
  }

  const handleRowNavigate = (jobId: number) => {
    navigate(`/app/jobs/${jobId}`)
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, jobId: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowNavigate(jobId)
    }
  }

  return (
    <section className={styles.jobs}>
      <header className={styles.header}>
        <h1>Jobs</h1>
        <p>Review recent jobs and inspect their most recent runs.</p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Jobs</h2>
        </div>

        {jobsQuery.isPending ? (
          <p className={styles.state}>Loading jobs…</p>
        ) : jobsQuery.isError ? (
          <p className={`${styles.state} ${styles.errorState}`}>
            Failed to load jobs: {getErrorMessage(jobsQuery.error)}
          </p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <caption className="sr-only">Submitted jobs</caption>
              <thead>
                <tr>
                  <th scope="col">Job ID</th>
                  <th scope="col">Image</th>
                  <th scope="col">GPU Profile</th>
                  <th scope="col">Last Run Started</th>
                  <th scope="col">Last Run Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.emptyCell}>
                      No jobs available.
                    </td>
                  </tr>
                ) : (
                  jobs.map(({ id, image, gpu_profile, latest_run: lastRun }) => {
                    const lastRunStatus = lastRun?.status
                    const lastRunStarted = lastRun?.started_at ?? null

                    return (
                      <tr
                        key={id}
                        className={styles.clickableRow}
                        tabIndex={0}
                        role="link"
                        aria-label={`View details for job #${id}`}
                        onClick={() => handleRowNavigate(id)}
                        onKeyDown={(event) => handleRowKeyDown(event, id)}
                      >
                        <td>#{id}</td>
                        <td className={styles.monospace}>{image}</td>
                        <td>{gpu_profile}</td>
                        <td>{formatDateTime(lastRunStarted)}</td>
                        <td>
                          {lastRunStatus ? (
                            <span className={getStatusClassName(lastRunStatus)}>{formatStatusLabel(lastRunStatus)}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}

export default Jobs
