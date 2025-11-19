import { useCallback, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { JSX } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import styles from './VolumeDetail.module.css'

const API_BASE = '/api' as const
const DEFAULT_MAX_KEYS = 200

type VolumeInfo = {
  id: number
  pvc_name: string
  size: number
  key_prefix: string | null
  is_input: boolean
}

type VolumeObject = {
  key: string
  size: number
  last_modified: string
  etag: string
}

type VolumeObjectsResponse = {
  prefix: string | null
  objects: VolumeObject[]
  truncated: boolean
  next_continuation_token: string | null
}

type VolumeDetailState = {
  volume?: VolumeInfo
  jobId?: string
  runId?: string
}

const isVolumeObject = (value: unknown): value is VolumeObject => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  return (
    typeof record.key === 'string' &&
    typeof record.size === 'number' &&
    typeof record.last_modified === 'string' &&
    typeof record.etag === 'string'
  )
}

const isVolumeObjectsResponse = (value: unknown): value is VolumeObjectsResponse => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const { prefix, objects, truncated, next_continuation_token: nextToken } = record

  return (
    (prefix === null || typeof prefix === 'string') &&
    Array.isArray(objects) &&
    objects.every(isVolumeObject) &&
    typeof truncated === 'boolean' &&
    (nextToken === null || typeof nextToken === 'string')
  )
}

const fetchVolumeObjects = async (volumeId: string, continuationToken: string | null): Promise<VolumeObjectsResponse> => {
  const params = new URLSearchParams()
  params.set('max_keys', String(DEFAULT_MAX_KEYS))
  if (continuationToken) params.set('continuation_token', continuationToken)

  const url = `${API_BASE}/volumes/${volumeId}/objects${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load objects for volume #${volumeId} (${response.status})`)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable volume object response. Please try again.')
  }

  if (!isVolumeObjectsResponse(payload)) {
    throw new Error('Received malformed volume objects response. Please contact support.')
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

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback

const VolumeDetail = (): JSX.Element => {
  const navigate = useNavigate()
  const location = useLocation()
  const { volumeId: routeVolumeId } = useParams<{
    volumeId: string
  }>()

  const state = location.state as VolumeDetailState | undefined
  const volume = state?.volume

  const volumeId = routeVolumeId ?? (volume ? String(volume.id) : '')

  const volumeQuery = useInfiniteQuery<VolumeObjectsResponse, Error>({
    queryKey: ['volumes', 'objects', volumeId],
    queryFn: ({ pageParam }) => fetchVolumeObjects(volumeId, (pageParam as string | undefined) ?? null),
    enabled: Boolean(volumeId),
    getNextPageParam: (lastPage) => (lastPage.truncated ? lastPage.next_continuation_token ?? undefined : undefined),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const objects = useMemo(() => {
    const pages = volumeQuery.data?.pages ?? []
    return pages.flatMap((page) => page.objects)
  }, [volumeQuery.data])

  const prefix = useMemo(() => {
    const firstPrefix = volumeQuery.data?.pages?.[0]?.prefix
    if (firstPrefix !== undefined && firstPrefix !== null) return firstPrefix
    return volume?.key_prefix ?? null
  }, [volumeQuery.data, volume?.key_prefix])

  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [activeDownloadKey, setActiveDownloadKey] = useState<string | null>(null)

  const handleBack = () => {
    navigate(-1)
  }

  const handleDownload = useCallback(
    async (objectKey: string) => {
      if (!volumeId) return

      setDownloadError(null)
      setActiveDownloadKey(objectKey)

      try {
        const params = new URLSearchParams({ key: objectKey })
        const response = await fetch(`${API_BASE}/volumes/${volumeId}/file?${params.toString()}`, {
          method: 'GET',
          credentials: 'include',
        })

        if (!response.ok) {
          throw new Error(`Failed to download ${objectKey} (${response.status})`)
        }

        const blob = await response.blob()
        const blobUrl = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = objectKey.split('/').pop() || objectKey
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(blobUrl)
      } catch (error) {
        setDownloadError(getErrorMessage(error, `Failed to download ${objectKey}.`))
      } finally {
        setActiveDownloadKey(null)
      }
    },
    [volumeId],
  )

  const headerTitle = volume ? `Volume ${volume.is_input ? 'Input' : 'Output'} #${volume.id}` : `Volume #${volumeId || 'Unknown'}`
  const volumeSubtitle = volume
    ? `PVC ${volume.pvc_name} (${volume.size} Gi)`
    : 'Explore the objects stored for this volume.'

  const stateMessage = (() => {
    if (!volumeId) return 'Volume identifier is missing.'
    if (volumeQuery.isPending) return 'Loading volume objects…'
    if (volumeQuery.isError) return volumeQuery.error.message
    if (objects.length === 0) return 'No objects were found for this volume.'
    return null
  })()

  const stateIsError = Boolean(stateMessage && volumeQuery.isError)
  const stateClassName = stateIsError ? `${styles.state} ${styles.stateError}` : styles.state

  return (
    <section className={styles.volumeDetail}>
      <header className={styles.header}>
        <div>
          <h1>{headerTitle}</h1>
          <p>{volumeSubtitle}</p>
          {prefix ? <p className={styles.prefix}>Prefix: {prefix}</p> : null}
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.backButton} onClick={handleBack}>
            Back
          </button>
        </div>
      </header>

      {downloadError ? <p className={`${styles.state} ${styles.stateError}`}>{downloadError}</p> : null}

      {stateMessage ? (
        <p className={stateClassName}>{stateMessage}</p>
      ) : (
        <section className={styles.objectsSection} aria-labelledby="volume-objects-heading">
          <div className={styles.sectionHeading}>
            <h2 id="volume-objects-heading">Objects</h2>
            <p>Inspect and download files stored for this volume.</p>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <caption className="sr-only">Volume objects</caption>
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Size</th>
                  <th scope="col">Last Modified</th>
                  <th scope="col" className={styles.actionsHeading}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {objects.map((object) => (
                  <tr key={object.key}>
                    <td className={styles.monospace}>{object.key}</td>
                    <td>{formatFileSize(object.size)}</td>
                    <td>{formatDateTime(object.last_modified)}</td>
                    <td className={styles.actionsCell}>
                      <button
                        type="button"
                        className={styles.downloadButton}
                        onClick={() => handleDownload(object.key)}
                        disabled={activeDownloadKey === object.key}
                      >
                        {activeDownloadKey === object.key ? 'Downloading…' : 'Download'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {volumeQuery.hasNextPage ? (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.loadMoreButton}
                onClick={() => volumeQuery.fetchNextPage()}
                disabled={volumeQuery.isFetchingNextPage}
              >
                {volumeQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null}
        </section>
      )}
    </section>
  )
}

export default VolumeDetail
