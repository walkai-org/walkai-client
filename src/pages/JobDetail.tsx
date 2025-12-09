import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSX } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styles from './JobDetail.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;
const JOB_DETAIL_STALE_TIME_MS = 5_000
const JOB_DETAIL_REFETCH_INTERVAL_MS = 5_000
const JOB_PRIORITIES: JobPriority[] = ['low', 'medium', 'high', 'extra-high']
const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'extra-high': 'Extra high',
}
const PRIORITY_STYLE_MAP: Record<JobPriority, string> = {
  low: styles.priorityLow,
  medium: styles.priorityMedium,
  high: styles.priorityHigh,
  'extra-high': styles.priorityExtraHigh,
}

type JobPriority = 'low' | 'medium' | 'high' | 'extra-high'

type JobRunSummary = {
  id: number
  status: string
  k8s_pod_name: string
  started_at: string | null
  finished_at: string | null
}

type JobDetailRecord = {
  id: number
  image: string
  gpu_profile: string
  priority: JobPriority
  submitted_at: string
  created_by_id: number
  runs: JobRunSummary[]
}

const isJobPriority = (value: unknown): value is JobPriority =>
  typeof value === 'string' && JOB_PRIORITIES.includes(value as JobPriority)

const isJobRunSummary = (value: unknown): value is JobRunSummary => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const isNullableString = (input: unknown) => input === null || typeof input === 'string'

  return (
    typeof record.id === 'number' &&
    typeof record.status === 'string' &&
    typeof record.k8s_pod_name === 'string' &&
    isNullableString(record.started_at) &&
    isNullableString(record.finished_at)
  )
}

const isJobDetail = (value: unknown): value is JobDetailRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  return (
    typeof record.id === 'number' &&
    typeof record.image === 'string' &&
    typeof record.gpu_profile === 'string' &&
    isJobPriority(record.priority) &&
    typeof record.submitted_at === 'string' &&
    typeof record.created_by_id === 'number' &&
    Array.isArray(record.runs) &&
    record.runs.every(isJobRunSummary)
  )
}

const fetchJobDetail = async (jobId: string): Promise<JobDetailRecord> => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load job #${jobId} (${response.status})`)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable job response. Please try again.')
  }

  if (!isJobDetail(payload)) {
    throw new Error('Received malformed job detail response. Please contact support.')
  }

  return payload
}

const createJobRun = async (jobId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/runs`, {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = `Failed to trigger a new run for job #${jobId} (${response.status}).`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      const errorDetail = payload?.detail
      if (typeof errorDetail === 'string' && errorDetail.trim()) {
        detail = errorDetail
      } else if (Array.isArray(errorDetail)) {
        const message = errorDetail
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const maybeRecord = item as { msg?: unknown }
            return typeof maybeRecord.msg === 'string' ? maybeRecord.msg : null
          })
          .filter((msg): msg is string => Boolean(msg))
          .join('\n')
        if (message) {
          detail = message
        }
      }
    } catch {
      // ignore JSON parsing errors in the error branch
    }
    throw new Error(detail)
  }
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

const formatPriorityLabel = (priority: string | null | undefined): string => {
  if (!priority) return 'Unknown'
  if (isJobPriority(priority)) return PRIORITY_LABELS[priority]
  return formatStatusLabel(priority)
}

const getPriorityClassName = (priority: string | null | undefined): string => {
  const normalized = isJobPriority(priority) ? priority : null
  const modifier = normalized ? PRIORITY_STYLE_MAP[normalized] : styles.priorityUnknown
  return `${styles.priorityBadge} ${modifier}`.trim()
}

const getStatusStyleKey = (status: string): 'running' | 'pending' | 'failed' | 'succeeded' | 'unknown' => {
  const normalized = status.trim().toLowerCase()
  if (normalized.includes('run')) return 'running'
  if (normalized.includes('pend')) return 'pending'
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed'
  if (normalized.includes('succ') || normalized.includes('compl')) return 'succeeded'
  return 'unknown'
}


const JobDetail = (): JSX.Element => {
  const { jobId: routeJobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [rerunError, setRerunError] = useState<string | null>(null)

  const jobId = routeJobId ?? ''

  const jobQuery = useQuery<JobDetailRecord, Error>({
    queryKey: ['jobs', 'detail', jobId],
    queryFn: () => fetchJobDetail(jobId),
    enabled: Boolean(jobId),
    staleTime: JOB_DETAIL_STALE_TIME_MS,
    refetchInterval: JOB_DETAIL_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const job = jobQuery.data

  const runs = useMemo(() => job?.runs ?? [], [job])
  const rerunMutation = useMutation<void, Error>({
    mutationFn: async () => {
      if (!jobId) {
        throw new Error('Missing job identifier for rerun.')
      }
      await createJobRun(jobId)
    },
    onSuccess: async () => {
      setRerunError(null)
      await queryClient.invalidateQueries({ queryKey: ['jobs', 'detail', jobId] })
    },
    onError: (error) => {
      setRerunError(error.message || 'Failed to start a new run.')
    },
  })

  const getStatusClassName = (status: string): string => {
    const key = getStatusStyleKey(status)
    const modifier = styles[key] ?? styles.unknown
    return `${styles.statusBadge} ${modifier}`.trim()
  }

  const handleBack = () => {
    navigate(-1)
  }

  const handleRerun = () => {
    setRerunError(null)
    rerunMutation.mutate()
  }

  const isRerunDisabled = !job || jobQuery.isPending || rerunMutation.isPending

  return (
    <section className={styles.jobDetail}>
      <header className={styles.header}>
        <div>
          <h1>Job #{jobId}</h1>
          <p>Inspect the latest runs and configuration for this job.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.backButton} onClick={handleBack}>
            Back
          </button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={handleRerun}
            disabled={isRerunDisabled}
          >
            {rerunMutation.isPending ? 'Starting rerun…' : 'Rerun job'}
          </button>
        </div>
      </header>

      {jobQuery.isPending ? (
        <p className={styles.state}>Loading job details…</p>
      ) : jobQuery.isError ? (
        <p className={`${styles.state} ${styles.stateError}`}>{jobQuery.error.message}</p>
      ) : !job ? (
        <p className={styles.state}>Job details were not found.</p>
      ) : (
        <>
          <section className={styles.metaSection} aria-labelledby="job-overview-heading">
            <h2 id="job-overview-heading">Overview</h2>
            <dl className={styles.metaGrid}>
              <div>
                <dt>Image</dt>
                <dd className={styles.monospace}>{job.image}</dd>
              </div>
              <div>
                <dt>GPU Profile</dt>
                <dd>
                  <span className={styles.gpuBadge}>{job.gpu_profile}</span>
                </dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>
                  <span className={getPriorityClassName(job.priority)}>{formatPriorityLabel(job.priority)}</span>
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{formatDateTime(job.submitted_at)}</dd>
              </div>
              <div>
                <dt>Owner ID</dt>
                <dd>#{job.created_by_id}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.runsSection} aria-labelledby="job-runs-heading">
            <div className={styles.runsHeading}>
              <h2 id="job-runs-heading">Runs</h2>
              <p>Review each run’s timing and status, then open a run for detailed information and logs.</p>
            </div>
            {rerunError ? <p className={`${styles.state} ${styles.stateError}`}>{rerunError}</p> : null}

            {runs.length === 0 ? (
              <p className={styles.state}>This job has not executed any runs yet.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <caption className="sr-only">Job runs</caption>
                  <thead>
                    <tr>
                      <th scope="col">Run ID</th>
                      <th scope="col">Status</th>
                      <th scope="col">Started</th>
                      <th scope="col">Finished</th>
                      <th scope="col">Pod</th>
                      <th scope="col" className={styles.actionsHeading}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(
                      ({
                        id,
                        status,
                        started_at: startedAt,
                        finished_at: finishedAt,
                        k8s_pod_name: podName,
                      }) => (
                        <tr
                          key={id}
                          className={styles.clickableRow}
                          tabIndex={0}
                          role="link"
                          aria-label={`View details for run #${id}`}
                          onClick={() => navigate(`/app/jobs/${jobId}/runs/${id}`)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/app/jobs/${jobId}/runs/${id}`)
                            }
                          }}
                        >
                          <td>#{id}</td>
                          <td>
                            <span className={getStatusClassName(status)}>{formatStatusLabel(status)}</span>
                          </td>
                          <td>{formatDateTime(startedAt)}</td>
                          <td>{formatDateTime(finishedAt)}</td>
                          <td className={styles.monospace}>{podName}</td>
                          <td>
                            <button
                              type="button"
                              className={styles.detailsButton}
                              onClick={(event) => {
                                event.stopPropagation()
                                navigate(`/app/jobs/${jobId}/runs/${id}`)
                              }}
                            >
                              View run
                            </button>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

export default JobDetail
