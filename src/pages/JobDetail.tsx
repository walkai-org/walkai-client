import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent, JSX, ReactNode } from 'react'
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

type JobScheduleKind = 'once' | 'cron'

type JobSchedule = {
  id: number
  job_id: number
  kind: JobScheduleKind
  run_at: string | null
  cron: string | null
  next_run_at: string | null
  last_run_at: string | null
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

const isJobScheduleKind = (value: unknown): value is JobScheduleKind =>
  value === 'once' || value === 'cron'

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

const isJobSchedule = (value: unknown): value is JobSchedule => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const isNullableString = (input: unknown) => input === null || typeof input === 'string'

  return (
    typeof record.id === 'number' &&
    typeof record.job_id === 'number' &&
    isJobScheduleKind(record.kind) &&
    isNullableString(record.run_at) &&
    isNullableString(record.cron) &&
    isNullableString(record.next_run_at) &&
    isNullableString(record.last_run_at)
  )
}

const isJobScheduleList = (value: unknown): value is JobSchedule[] =>
  Array.isArray(value) && value.every(isJobSchedule)

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

const createJobSchedule = async (
  jobId: string,
  payload: { kind: JobScheduleKind; run_at: string | null; cron: string | null },
): Promise<void> => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/schedules`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let detail = `Failed to create schedule for job #${jobId} (${response.status}).`
    try {
      const responsePayload = (await response.json()) as { detail?: unknown }
      const errorDetail = responsePayload?.detail
      if (typeof errorDetail === 'string' && errorDetail.trim()) {
        detail = errorDetail
      }
    } catch {
      // ignore JSON parsing errors in the error branch
    }
    throw new Error(detail)
  }
}

const fetchJobSchedules = async (jobId: string): Promise<JobSchedule[]> => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/schedules`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load schedules for job #${jobId} (${response.status})`)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable job schedule response. Please try again.')
  }

  if (!isJobScheduleList(payload)) {
    throw new Error('Received malformed job schedule response. Please contact support.')
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

const deleteJobSchedule = async (jobId: string, scheduleId: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/schedules/${scheduleId}`, {
    method: 'DELETE',
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = `Failed to delete schedule #${scheduleId} for job #${jobId}.`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      const errorDetail = payload?.detail
      if (typeof errorDetail === 'string' && errorDetail.trim()) {
        detail = errorDetail
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

const PROFILE_USAGE_PATH = '/app/profile'
const formatQuotaAwareError = (message: string): ReactNode => {
  const normalized = message.toLowerCase()
  const isQuotaExceeded =
    normalized.includes('high-priority quota exceeded') || normalized.includes('high priority quota exceeded')
  if (isQuotaExceeded) {
    return (
      <>
        <span>{message}</span>{' '}
        <a className={styles.inlineLink} href={PROFILE_USAGE_PATH}>
          See usage
        </a>
      </>
    )
  }
  return message
}

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
  const [rerunError, setRerunError] = useState<ReactNode | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [deletingScheduleId, setDeletingScheduleId] = useState<number | null>(null)
  const [isAddScheduleOpen, setIsAddScheduleOpen] = useState(false)
  const [scheduleKind, setScheduleKind] = useState<JobScheduleKind>('once')
  const [scheduleRunAt, setScheduleRunAt] = useState('')
  const [scheduleCron, setScheduleCron] = useState('')
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null)

  const jobId = routeJobId ?? ''

  const jobQuery = useQuery<JobDetailRecord, Error>({
    queryKey: ['jobs', 'detail', jobId],
    queryFn: () => fetchJobDetail(jobId),
    enabled: Boolean(jobId),
    staleTime: JOB_DETAIL_STALE_TIME_MS,
    refetchInterval: JOB_DETAIL_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const schedulesQuery = useQuery<JobSchedule[], Error>({
    queryKey: ['jobs', 'schedules', jobId],
    queryFn: () => fetchJobSchedules(jobId),
    enabled: Boolean(jobId),
    staleTime: JOB_DETAIL_STALE_TIME_MS,
    refetchInterval: JOB_DETAIL_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const job = jobQuery.data

  const schedules = schedulesQuery.data ?? []
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
      const message = error.message || 'Failed to start a new run.'
      setRerunError(formatQuotaAwareError(message))
    },
  })

  const deleteScheduleMutation = useMutation<void, Error, number>({
    mutationFn: async (scheduleId) => {
      if (!jobId) {
        throw new Error('Missing job identifier for schedule deletion.')
      }
      await deleteJobSchedule(jobId, scheduleId)
    },
    onMutate: (scheduleId) => {
      setScheduleError(null)
      setDeletingScheduleId(scheduleId)
    },
    onSuccess: async () => {
      setDeletingScheduleId(null)
      await queryClient.invalidateQueries({ queryKey: ['jobs', 'schedules', jobId] })
    },
    onError: (error) => {
      setDeletingScheduleId(null)
      setScheduleError(error.message || 'Failed to delete schedule.')
    },
  })

  const createScheduleMutation = useMutation<void, Error, { kind: JobScheduleKind; run_at: string | null; cron: string | null }>({
    mutationFn: async (payload) => {
      if (!jobId) {
        throw new Error('Missing job identifier for schedule creation.')
      }
      await createJobSchedule(jobId, payload)
    },
    onMutate: () => {
      setScheduleFormError(null)
      setScheduleError(null)
    },
    onSuccess: async () => {
      setIsAddScheduleOpen(false)
      setScheduleRunAt('')
      setScheduleCron('')
      setScheduleKind('once')
      await queryClient.invalidateQueries({ queryKey: ['jobs', 'schedules', jobId] })
    },
    onError: (error) => {
      setScheduleFormError(error.message || 'Failed to create schedule.')
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

  const handleOpenAddSchedule = () => {
    setScheduleFormError(null)
    setIsAddScheduleOpen(true)
  }

  const handleCloseAddSchedule = () => {
    setIsAddScheduleOpen(false)
    setScheduleFormError(null)
    setScheduleRunAt('')
    setScheduleCron('')
    setScheduleKind('once')
  }

  const handleCreateSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setScheduleFormError(null)

    if (!job) {
      setScheduleFormError('Job details are still loading.')
      return
    }

    if (scheduleKind === 'once') {
      if (!scheduleRunAt.trim()) {
        setScheduleFormError('Please provide a run time for a one-time schedule.')
        return
      }
      const parsed = new Date(scheduleRunAt)
      if (Number.isNaN(parsed.getTime())) {
        setScheduleFormError('Run time is invalid. Please select a valid date and time.')
        return
      }
      createScheduleMutation.mutate({ kind: 'once', run_at: parsed.toISOString(), cron: null })
      return
    }

    if (!scheduleCron.trim()) {
      setScheduleFormError('Please provide a cron expression.')
      return
    }

    createScheduleMutation.mutate({ kind: 'cron', run_at: null, cron: scheduleCron.trim() })
  }

  const isRerunDisabled = !job || jobQuery.isPending || rerunMutation.isPending
  const isAddScheduleDisabled = !job || jobQuery.isPending
  const isCreatingSchedule = createScheduleMutation.isPending

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
            className={styles.addScheduleButton}
            onClick={handleOpenAddSchedule}
            disabled={isAddScheduleDisabled}
          >
            Add schedule
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

      {isAddScheduleOpen && job ? (
        <div className={styles.modalOverlay} role="presentation" onClick={handleCloseAddSchedule}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-schedule-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.modalHeader}>
              <div>
                <h2 id="add-schedule-title">Add schedule</h2>
                <p className={styles.modalDescription}>Trigger this job on a cron or at a specific time.</p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleCloseAddSchedule}
                aria-label="Close add schedule dialog"
                disabled={isCreatingSchedule}
              >
                ×
              </button>
            </header>
            <form className={styles.modalForm} onSubmit={handleCreateSchedule} noValidate>
              <div className={styles.fieldGroup}>
                <label htmlFor="schedule-kind">Type</label>
                <select
                  id="schedule-kind"
                  name="schedule-kind"
                  className={styles.select}
                  value={scheduleKind}
                  onChange={(event) => {
                    const nextKind = event.target.value as JobScheduleKind
                    setScheduleKind(nextKind)
                    setScheduleFormError(null)
                    if (nextKind === 'once') {
                      setScheduleCron('')
                    } else {
                      setScheduleRunAt('')
                    }
                  }}
                  disabled={isCreatingSchedule}
                >
                  <option value="once">Once</option>
                  <option value="cron">Cron</option>
                </select>
              </div>

              {scheduleKind === 'once' ? (
                <div className={styles.fieldGroup}>
                  <label htmlFor="schedule-run-at">Run at</label>
                  <input
                    id="schedule-run-at"
                    name="schedule-run-at"
                    type="datetime-local"
                    className={styles.textInput}
                    value={scheduleRunAt}
                    onChange={(event) => setScheduleRunAt(event.target.value)}
                    disabled={isCreatingSchedule}
                  />
                  <p className={styles.helperText}>Local time will be converted to UTC when saved.</p>
                </div>
              ) : (
                <div className={styles.fieldGroup}>
                  <label htmlFor="schedule-cron">Cron expression</label>
                  <input
                    id="schedule-cron"
                    name="schedule-cron"
                    type="text"
                    className={styles.textInput}
                    placeholder="*/5 * * * *"
                    value={scheduleCron}
                    onChange={(event) => setScheduleCron(event.target.value)}
                    disabled={isCreatingSchedule}
                  />
                  <p className={styles.helperText}>Provide a standard cron string in UTC.</p>
                </div>
              )}

              {scheduleFormError ? <p className={styles.formError}>{scheduleFormError}</p> : null}

              <footer className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.modalSecondaryButton}
                  onClick={handleCloseAddSchedule}
                  disabled={isCreatingSchedule}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.modalPrimaryButton} disabled={isCreatingSchedule}>
                  {isCreatingSchedule ? 'Adding…' : 'Add schedule'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

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

          <section className={styles.schedulesSection} aria-labelledby="job-schedules-heading">
            <div className={styles.schedulesHeading}>
              <h2 id="job-schedules-heading">Schedules</h2>
              <p>Review upcoming triggers for this job or remove schedules that are no longer needed.</p>
            </div>
            {scheduleError ? <p className={`${styles.state} ${styles.stateError}`}>{scheduleError}</p> : null}

            {schedulesQuery.isPending ? (
              <p className={styles.state}>Loading schedules…</p>
            ) : schedulesQuery.isError ? (
              <p className={`${styles.state} ${styles.stateError}`}>{schedulesQuery.error.message}</p>
            ) : schedules.length === 0 ? (
              <p className={styles.state}>No schedules configured for this job.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <caption className="sr-only">Job schedules</caption>
                  <thead>
                    <tr>
                      <th scope="col">Schedule</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Timing</th>
                      <th scope="col">Next run</th>
                      <th scope="col">Last run</th>
                      <th scope="col" className={styles.actionsHeading}>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map(
                      ({ id, kind, run_at: runAt, cron, next_run_at: nextRunAt, last_run_at: lastRunAt }) => {
                        const isDeleting = deletingScheduleId === id && deleteScheduleMutation.isPending
                        const timing =
                          kind === 'cron'
                            ? cron
                              ? <span className={styles.monospace}>{cron}</span>
                              : '—'
                            : formatDateTime(runAt)
                        return (
                          <tr key={id}>
                            <td>#{id}</td>
                            <td>{formatStatusLabel(kind)}</td>
                            <td>{timing}</td>
                            <td>{formatDateTime(nextRunAt)}</td>
                            <td>{formatDateTime(lastRunAt)}</td>
                            <td className={styles.actionsCell}>
                              <button
                                type="button"
                                className={styles.deleteButton}
                                onClick={() => deleteScheduleMutation.mutate(id)}
                                disabled={isDeleting}
                                aria-label={`Delete schedule #${id}`}
                              >
                                {isDeleting ? '…' : '×'}
                              </button>
                            </td>
                          </tr>
                        )
                      },
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
