import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { JSX } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import styles from './JobDetail.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

type VolumeInfo = {
  id: number
  pvc_name: string
  size: number
  key_prefix: string | null
  is_input: boolean
  state: string
}

type JobRunDetail = {
  id: number
  status: string
  k8s_job_name: string
  k8s_pod_name: string
  started_at: string | null
  finished_at: string | null
  output_volume: VolumeInfo | null
  input_volume: VolumeInfo | null
}

type JobDetailRecord = {
  id: number
  image: string
  gpu_profile: string
  submitted_at: string
  created_by_id: number
  runs: JobRunDetail[]
}

const isVolumeInfo = (value: unknown): value is VolumeInfo => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  return (
    typeof record.id === 'number' &&
    typeof record.pvc_name === 'string' &&
    typeof record.size === 'number' &&
    (record.key_prefix === null || typeof record.key_prefix === 'string') &&
    typeof record.is_input === 'boolean' &&
    typeof record.state === 'string'
  )
}

const isJobRunDetail = (value: unknown): value is JobRunDetail => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const isNullableString = (input: unknown) => input === null || typeof input === 'string'

  return (
    typeof record.id === 'number' &&
    typeof record.status === 'string' &&
    typeof record.k8s_job_name === 'string' &&
    typeof record.k8s_pod_name === 'string' &&
    isNullableString(record.started_at) &&
    isNullableString(record.finished_at) &&
    (record.output_volume === null || isVolumeInfo(record.output_volume)) &&
    (record.input_volume === null || isVolumeInfo(record.input_volume))
  )
}

const isJobDetail = (value: unknown): value is JobDetailRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  return (
    typeof record.id === 'number' &&
    typeof record.image === 'string' &&
    typeof record.gpu_profile === 'string' &&
    typeof record.submitted_at === 'string' &&
    typeof record.created_by_id === 'number' &&
    Array.isArray(record.runs) &&
    record.runs.every(isJobRunDetail)
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


const JobDetail = (): JSX.Element => {
  const { jobId: routeJobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()

  const jobId = routeJobId ?? ''

  const jobQuery = useQuery<JobDetailRecord, Error>({
    queryKey: ['jobs', 'detail', jobId],
    queryFn: () => fetchJobDetail(jobId),
    enabled: Boolean(jobId),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const job = jobQuery.data

  const runs = useMemo(() => job?.runs ?? [], [job])

  const getStatusClassName = (status: string): string => {
    const key = getStatusStyleKey(status)
    const modifier = styles[key] ?? styles.unknown
    return `${styles.statusBadge} ${modifier}`.trim()
  }

  const handleBack = () => {
    navigate(-1)
  }

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
          <Link to="/app/jobs" className={styles.linkButton}>
            View all jobs
          </Link>
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
                <dd>{job.gpu_profile}</dd>
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
              <p>Review each run’s timing, status, and associated volumes.</p>
            </div>

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
                      <th scope="col">K8s Job</th>
                      <th scope="col">Output Volume</th>
                      <th scope="col">Input Volume</th>
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
                        output_volume: outputVolume,
                        input_volume: inputVolume,
                        k8s_job_name: jobName,
                      }) => (
                        <tr key={id}>
                          <td>#{id}</td>
                          <td>
                            <span className={getStatusClassName(status)}>{formatStatusLabel(status)}</span>
                          </td>
                          <td>{formatDateTime(startedAt)}</td>
                          <td>{formatDateTime(finishedAt)}</td>
                          <td className={styles.monospace}>{podName}</td>
                          <td className={styles.monospace}>{jobName}</td>
                          <td>{outputVolume?.pvc_name}</td>
                          <td>{inputVolume?.pvc_name}</td>
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
