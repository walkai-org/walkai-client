import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { JSX, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { GPU_PROFILE_ORDER, GPU_PROFILES, formatGpuLabel, getProfileOrder, type GPUProfile } from '../constants/gpuProfiles'
import styles from './Dashboard.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;

const DASHBOARD_STALE_TIME_MS = 4_000
const DASHBOARD_REFETCH_INTERVAL_MS = 5_000

type ClusterResource = {
  gpu: GPUProfile
  allocated: number
  available: number
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const isClusterResource = (value: unknown): value is ClusterResource => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const gpu = record.gpu
  const allocated = record.allocated
  const available = record.available

  const isGpuProfile = typeof gpu === 'string' && GPU_PROFILE_ORDER.has(gpu as GPUProfile)

  return (
    isGpuProfile &&
    typeof allocated === 'number' &&
    Number.isInteger(allocated) &&
    allocated >= 0 &&
    typeof available === 'number' &&
    Number.isInteger(available) &&
    available >= 0
  )
}

type ClusterPod = {
  name: string
  namespace: string
  status: string
  gpu: GPUProfile
  start_time: string | null
  finish_time: string | null
}

const POD_NAME_SLICE_LENGTH = 8

const cropPodName = (name: string): string => {
  if (name.length <= POD_NAME_SLICE_LENGTH) return name
  return `${name.slice(0, POD_NAME_SLICE_LENGTH)}...`
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

const isClusterPod = (value: unknown): value is ClusterPod => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const name = record.name
  const namespace = record.namespace
  const status = record.status
  const gpu = record.gpu
  const startTime = record.start_time
  const finishTime = record.finish_time

  const isGpuProfile = typeof gpu === 'string' && GPU_PROFILE_ORDER.has(gpu as GPUProfile)
  const isDateValue = (value: unknown) => value === null || typeof value === 'string'

  return (
    typeof name === 'string' &&
    name.length > 0 &&
    typeof namespace === 'string' &&
    namespace.length > 0 &&
    typeof status === 'string' &&
    status.length > 0 &&
    isGpuProfile &&
    isDateValue(startTime) &&
    isDateValue(finishTime)
  )
}

const fetchClusterResources = async (): Promise<ClusterResource[]> => {
  const response = await fetch(`${API_BASE}/cluster/resources`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = 'Failed to load GPU resource data. Please try again.'
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail
      }
    } catch {
      // ignore JSON parsing errors from error responses
    }
    throw new Error(detail)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable GPU resource response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isClusterResource)) {
    throw new Error('Received malformed GPU resource response. Please contact support.')
  }

  return payload
}

const fetchClusterPods = async (): Promise<ClusterPod[]> => {
  const response = await fetch(`${API_BASE}/cluster/pods`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = 'Failed to load pod data. Please try again.'
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail
      }
    } catch {
      // ignore JSON parsing errors from error responses
    }
    throw new Error(detail)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable pod response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isClusterPod)) {
    throw new Error('Received malformed pod response. Please contact support.')
  }

  return payload
}

const Dashboard = (): JSX.Element => {
  const navigate = useNavigate()

  const resourcesQuery = useQuery<ClusterResource[], Error>({
    queryKey: ['cluster', 'resources'],
    queryFn: fetchClusterResources,
    staleTime: DASHBOARD_STALE_TIME_MS,
    refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const podsQuery = useQuery<ClusterPod[], Error>({
    queryKey: ['cluster', 'pods'],
    queryFn: fetchClusterPods,
    staleTime: DASHBOARD_STALE_TIME_MS,
    refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const resources = useMemo(() => {
    if (!resourcesQuery.data) return []
    return [...resourcesQuery.data].sort((a, b) => getProfileOrder(a.gpu) - getProfileOrder(b.gpu))
  }, [resourcesQuery.data])

  const pods = podsQuery.data ?? []

  const getStatusClassName = (status: string): string => {
    const key = getStatusStyleKey(status)
    const modifier = styles[key] ?? styles.unknown
    return `${styles.podStatus} ${modifier}`.trim()
  }

  const handleRowNavigate = (pod: ClusterPod) => {
    const podNameParam = encodeURIComponent(pod.name)
    navigate(`/app/pods/${podNameParam}`, { state: { pod } })
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, pod: ClusterPod) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowNavigate(pod)
    }
  }

  return (
    <section className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1>Dashboard</h1>
          <p>Review your cluster capacity and GPU allocation at a glance.</p>
        </div>
      </header>

      <section className={styles.resourcesSection} aria-labelledby="gpu-resources-heading">
        <div className={styles.resourcesHeading}>
          <h2 id="gpu-resources-heading">Cluster GPU Resources</h2>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.legendAllocated}`} aria-hidden />
              <span>Allocated</span>
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.legendAvailable}`} aria-hidden />
              <span>Available</span>
            </span>
          </div>
        </div>

        {resourcesQuery.isPending ? (
          <p className={styles.state}>Loading cluster resources…</p>
        ) : resourcesQuery.isError ? (
          <p className={`${styles.state} ${styles.stateError}`}>
            {getErrorMessage(resourcesQuery.error, 'Unable to load cluster resources. Please try again later.')}
          </p>
        ) : resources.length === 0 ? (
          <p className={styles.state}>No GPU resources have been reported yet.</p>
        ) : (
          <div className={styles.resourceList}>
            {resources.map(({ gpu, allocated, available }) => {
              const squares = [
                ...Array.from({ length: allocated }, () => 'allocated' as const),
                ...Array.from({ length: available }, () => 'available' as const),
              ]

              const label = formatGpuLabel(gpu)

              return (
                <article key={gpu} className={styles.resourceCard}>
                  <header className={styles.resourceCardHeader}>
                    <h3>{label}</h3>
                    <dl className={styles.resourceStats}>
                      <div>
                        <dt>Allocated</dt>
                        <dd>{allocated}</dd>
                      </div>
                      <div>
                        <dt>Available</dt>
                        <dd>{available}</dd>
                      </div>
                    </dl>
                  </header>
                  <div className={styles.squareGrid}>
                    {squares.length === 0 ? (
                      <span className={styles.emptySquares}>No GPUs provisioned.</span>
                    ) : (
                      squares.map((status, index) => (
                        <span
                          key={`${gpu}-${status}-${index}`}
                          className={`${styles.square} ${
                            status === 'allocated' ? styles.squareAllocated : styles.squareAvailable
                          }`}
                          title={`${label} ${status === 'allocated' ? 'allocated' : 'available'}`}
                        >
                          {label}
                        </span>
                      ))
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className={styles.podsSection} aria-labelledby="running-pods-heading">
        <div className={styles.podsHeading}>
          <h2 id="running-pods-heading">Running Pods</h2>
          <p>Track active workloads and their GPU footprint.</p>
        </div>

        {podsQuery.isPending ? (
          <p className={styles.state}>Loading pods…</p>
        ) : podsQuery.isError ? (
          <p className={`${styles.state} ${styles.stateError}`}>
            {getErrorMessage(podsQuery.error, 'Unable to load pod data. Please try again later.')}
          </p>
        ) : pods.length === 0 ? (
          <p className={styles.state}>No pods are currently running.</p>
        ) : (
          <div className={styles.podsTableWrapper}>
            <table className={styles.podsTable}>
              <caption className="sr-only">Currently running pods</caption>
              <thead>
                <tr>
                  <th scope="col">Pod</th>
                  <th scope="col">Namespace</th>
                  <th scope="col">GPU</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Finished</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((pod) => {
                  const { name, namespace, status, gpu, start_time: startTime, finish_time: finishTime } = pod
                  return (
                    <tr
                      key={`${namespace}-${name}`}
                      className={styles.clickableRow}
                      tabIndex={0}
                      role="link"
                      aria-label={`View details for pod ${name}`}
                      onClick={() => handleRowNavigate(pod)}
                      onKeyDown={(event) => handleRowKeyDown(event, pod)}
                    >
                      <td className={styles.monospace}>
                        <span title={name}>{cropPodName(name)}</span>
                      </td>
                      <td className={styles.monospace}>{namespace}</td>
                      <td>{formatGpuLabel(gpu)}</td>
                      <td>
                        <span className={getStatusClassName(status)}>{formatStatusLabel(status)}</span>
                      </td>
                      <td>{formatDateTime(startTime)}</td>
                      <td>{formatDateTime(finishTime)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}

export default Dashboard
