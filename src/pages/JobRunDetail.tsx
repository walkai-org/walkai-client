import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { JSX } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchClusterPods, type ClusterPod } from '../api/clusterPods'
import styles from './JobRunDetail.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;
const MAX_LOG_LINES = 500
const POD_ACTIVITY_STALE_TIME_MS = 4_000
const POD_ACTIVITY_REFETCH_INTERVAL_MS = 5_000

type VolumeInfo = {
  id: number
  pvc_name: string
  size: number
  key_prefix: string | null
  is_input: boolean
}

type JobRunDetailRecord = {
  id: number
  status: string
  k8s_pod_name: string
  k8s_job_name: string
  started_at: string | null
  finished_at: string | null
  output_volume: VolumeInfo | null
  input_volume: VolumeInfo | null
}

const isVolumeInfo = (value: unknown): value is VolumeInfo => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  return (
    typeof record.id === 'number' &&
    typeof record.pvc_name === 'string' &&
    typeof record.size === 'number' &&
    (record.key_prefix === null || typeof record.key_prefix === 'string') &&
    typeof record.is_input === 'boolean'
  )
}

const isJobRunDetail = (value: unknown): value is JobRunDetailRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const isNullableString = (input: unknown) => input === null || typeof input === 'string'

  return (
    typeof record.id === 'number' &&
    typeof record.status === 'string' &&
    typeof record.k8s_pod_name === 'string' &&
    typeof record.k8s_job_name === 'string' &&
    isNullableString(record.started_at) &&
    isNullableString(record.finished_at) &&
    (record.output_volume === null || isVolumeInfo(record.output_volume)) &&
    (record.input_volume === null || isVolumeInfo(record.input_volume))
  )
}

const fetchJobRunDetail = async (jobId: string, runId: string): Promise<JobRunDetailRecord> => {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/runs/${runId}`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load run #${runId} for job #${jobId} (${response.status})`)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable run response. Please try again.')
  }

  if (!isJobRunDetail(payload)) {
    throw new Error('Received malformed run detail response. Please contact support.')
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

const getStatusStyleKey = (
  status: string,
): 'running' | 'pending' | 'failed' | 'succeeded' | 'unknown' => {
  const normalized = status.trim().toLowerCase()
  if (normalized.includes('run')) return 'running'
  if (normalized.includes('pend')) return 'pending'
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed'
  if (normalized.includes('succ') || normalized.includes('compl')) return 'succeeded'
  return 'unknown'
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const JobRunDetail = (): JSX.Element => {
  const navigate = useNavigate()
  const { jobId: routeJobId, runId: routeRunId } = useParams<{ jobId: string; runId: string }>()

  const jobId = routeJobId ?? ''
  const runId = routeRunId ?? ''
  const runQuery = useQuery<JobRunDetailRecord, Error>({
    queryKey: ['jobs', 'detail', jobId, 'runs', runId],
    queryFn: () => fetchJobRunDetail(jobId, runId),
    enabled: Boolean(jobId && runId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const run = runQuery.data
  const podName = run?.k8s_pod_name ?? ''
  const podDetailPath = podName ? `/app/pods/${encodeURIComponent(podName)}` : null
  const jobDetailPath = jobId ? `/app/jobs/${jobId}` : null

  const podAvailabilityQuery = useQuery<ClusterPod[], Error>({
    queryKey: ['cluster', 'pods', 'availability', podName],
    queryFn: fetchClusterPods,
    enabled: Boolean(podName),
    staleTime: POD_ACTIVITY_STALE_TIME_MS,
    refetchInterval: POD_ACTIVITY_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const activePod = useMemo(() => {
    if (!podName) return null
    return podAvailabilityQuery.data?.find((candidate) => candidate.name === podName) ?? null
  }, [podAvailabilityQuery.data, podName])

  const volumes = useMemo(() => {
    if (!run) return [] as Array<{ label: string; volume: VolumeInfo }>
    const next: Array<{ label: string; volume: VolumeInfo }> = []
    if (run.output_volume) next.push({ label: 'Output Volume', volume: run.output_volume })
    if (run.input_volume) next.push({ label: 'Input Volume', volume: run.input_volume })
    return next
  }, [run])

  const [logLines, setLogLines] = useState<string[]>([])
  const [logError, setLogError] = useState<string | null>(null)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  const shouldRenderPodButton = runQuery.isPending || Boolean(podName)
  const podButtonLabel = (() => {
    if (runQuery.isPending) return 'Loading pod…'
    if (!podName) return 'Pod unavailable'
    if (podAvailabilityQuery.isPending) return 'Checking pod…'
    if (podAvailabilityQuery.isError) return 'Pod unavailable'
    return activePod ? 'View pod' : 'Pod inactive'
  })()

  const podButtonDisabled =
    runQuery.isPending ||
    !podDetailPath ||
    podAvailabilityQuery.isPending ||
    podAvailabilityQuery.isError ||
    !activePod

  const jobButtonDisabled = !jobDetailPath
  const jobButtonTitle = jobButtonDisabled ? 'Job path is unavailable.' : undefined

  const podButtonTitle = (() => {
    if (podAvailabilityQuery.isError) return podAvailabilityQuery.error.message
    if (!activePod && podName && !podAvailabilityQuery.isPending) {
      return 'Pod is not active right now.'
    }
    return undefined
  })()

  useEffect(() => {
    if (!jobId || !runId) return undefined

    let isActive = true
    const controller = new AbortController()

    setLogLines([])
    setLogError(null)
    setIsLoadingLogs(true)

    const streamLogs = async () => {
      try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}/runs/${runId}/logs`, {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        })

        if (!response.ok) {
          let detail = `Failed to stream logs for run #${runId}.`
          try {
            const payload = (await response.json()) as { detail?: unknown }
            if (typeof payload?.detail === 'string' && payload.detail.trim()) {
              detail = payload.detail
            }
          } catch {
            // ignore parsing errors for error responses
          }
          if (!isActive) return
          setLogError(detail)
          return
        }

        const reader = response.body?.getReader()
        if (!reader) {
          if (!isActive) return
          setLogError('Log streaming is not supported by this browser.')
          return
        }

        const decoder = new TextDecoder()
        let pending = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          pending += decoder.decode(value, { stream: true })
          const parts = pending.split('\n')
          pending = parts.pop() ?? ''

          if (!isActive || parts.length === 0) continue

          setLogLines((previous) => {
            const next = [...previous, ...parts]
            if (next.length <= MAX_LOG_LINES) return next
            return next.slice(-MAX_LOG_LINES)
          })
        }

        const finalChunk = pending + decoder.decode()
        if (isActive && finalChunk) {
          setLogLines((previous) => {
            const next = [...previous, finalChunk]
            if (next.length <= MAX_LOG_LINES) return next
            return next.slice(-MAX_LOG_LINES)
          })
        }
      } catch (error) {
        if (controller.signal.aborted || !isActive) {
          return
        }
        setLogError(getErrorMessage(error, `Failed to stream logs for run #${runId}.`))
      } finally {
        if (isActive) {
          setIsLoadingLogs(false)
        }
      }
    }

    void streamLogs()

    return () => {
      isActive = false
      controller.abort()
    }
  }, [jobId, runId])

  const getStatusClassName = (status: string): string => {
    const key = getStatusStyleKey(status)
    const modifier = styles[key] ?? styles.unknown
    return `${styles.statusBadge} ${modifier}`.trim()
  }

  const handleViewJob = () => {
    if (!jobDetailPath) return
    navigate(jobDetailPath)
  }

  const handleViewPod = () => {
    if (!podDetailPath || !activePod) return
    navigate(podDetailPath, { state: { pod: activePod } })
  }

  const runState = (() => {
    if (!jobId || !runId) return 'Run path is incomplete.'
    if (run) return null
    if (runQuery.isPending) return 'Loading run details…'
    if (runQuery.isError) return runQuery.error.message
    return 'Run details were not found.'
  })()

  const runStateIsError = Boolean(runState && !runQuery.isPending)
  const runStateClassName = runStateIsError ? `${styles.state} ${styles.stateError}` : styles.state

  return (
    <section className={styles.runDetail}>
      <header className={styles.header}>
        <div>
          <h1>Run #{runId || 'Unknown'}</h1>
          <p>Inspect metadata, volume attachments, and live logs for job #{jobId || 'Unknown'}.</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.backButton}
            onClick={handleViewJob}
            disabled={jobButtonDisabled}
            title={jobButtonTitle}
          >
            Go to job
          </button>
          {shouldRenderPodButton && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={handleViewPod}
              disabled={podButtonDisabled}
              title={podButtonTitle}
            >
              {podButtonLabel}
            </button>
          )}
        </div>
      </header>

      {runState ? (
        <p className={runStateClassName}>{runState}</p>
      ) : (
        run && (
          <>
            <section className={styles.metaSection} aria-labelledby="run-overview-heading">
              <h2 id="run-overview-heading">Overview</h2>
              <dl className={styles.metaGrid}>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={getStatusClassName(run.status)}>{formatStatusLabel(run.status)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatDateTime(run.started_at)}</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatDateTime(run.finished_at)}</dd>
                </div>
                <div>
                  <dt>K8s Job</dt>
                  <dd className={styles.monospace}>{run.k8s_job_name}</dd>
                </div>
                <div>
                  <dt>Pod</dt>
                  <dd className={styles.monospace}>{run.k8s_pod_name}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.volumeSection} aria-labelledby="run-volumes-heading">
              <div className={styles.sectionHeading}>
                <h2 id="run-volumes-heading">Volumes</h2>
                <p>Review the persistent volumes that were attached to this run.</p>
              </div>

              {volumes.length === 0 ? (
                <p className={styles.state}>No volumes were attached to this run.</p>
              ) : (
                <div className={styles.volumeGrid}>
                  {volumes.map(({ label, volume }) => {
                    const volumeDetailsPath = jobId && runId ? `/app/jobs/${jobId}/runs/${runId}/volumes/${volume.id}` : null
                    return (
                      <article key={`${label}-${volume.id}`} className={styles.volumeCard}>
                        <h3>{label}</h3>
                        <dl>
                          <div>
                            <dt>PVC Name</dt>
                            <dd className={styles.monospace}>{volume.pvc_name}</dd>
                          </div>
                          <div>
                            <dt>Size (Gi)</dt>
                            <dd>{volume.size}</dd>
                          </div>
                          <div>
                            <dt>Key Prefix</dt>
                            <dd className={styles.monospace}>{volume.key_prefix ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>Type</dt>
                            <dd>{volume.is_input ? 'Input' : 'Output'}</dd>
                          </div>
                        </dl>
                        {volumeDetailsPath ? (
                          <div className={styles.volumeActions}>
                            <Link
                              to={volumeDetailsPath}
                              state={{
                                volume,
                                jobId,
                                runId,
                              }}
                              className={styles.volumeLink}
                            >
                              Browse objects
                            </Link>
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )
      )}

      <section className={styles.logsSection} aria-labelledby="run-logs-heading">
        <div className={styles.logsHeading}>
          <h2 id="run-logs-heading">Run Logs</h2>
        </div>

        {logError ? (
          <p className={`${styles.state} ${styles.stateError}`}>{logError}</p>
        ) : (
          <div className={styles.logsContainer} role="log" aria-live="polite">
            {logLines.length === 0 ? (
              <p>{isLoadingLogs ? 'Loading logs…' : 'No logs available for this run.'}</p>
            ) : (
              logLines.map((line, index) => (
                <p key={`run-${runId}-log-${index}`} className={styles.logLine}>
                  {line}
                </p>
              ))
            )}
          </div>
        )}
      </section>
    </section>
  )
}

export default JobRunDetail
