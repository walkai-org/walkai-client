import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, FormEvent, JSX, MouseEvent, KeyboardEvent } from 'react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './InputVolumes.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;
const DEFAULT_STORAGE_GIB = 1

type InputVolume = {
  id: number
  pvc_name: string
  size: number
  key_prefix: string | null
  is_input: boolean
}

type CreateVolumeResponse = {
  volume: InputVolume
}

type PresignedResponse = {
  presigneds: string[]
}

type UploadStatus = {
  fileName: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  message?: string
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback

const isVolume = (value: unknown): value is InputVolume => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'number' &&
    typeof record.pvc_name === 'string' &&
    typeof record.size === 'number' &&
    (typeof record.key_prefix === 'string' || record.key_prefix === null) &&
    typeof record.is_input === 'boolean'
  )
}

const isCreateVolumeResponse = (value: unknown): value is CreateVolumeResponse => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isVolume(record.volume)
}

const isPresignedResponse = (value: unknown): value is PresignedResponse => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.presigneds) && record.presigneds.every((item) => typeof item === 'string')
}

const fetchInputVolumes = async (): Promise<InputVolume[]> => {
  const params = new URLSearchParams({ is_input: 'true' })
  const response = await fetch(`${API_BASE}/volumes/?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to load input volumes (${response.status})`)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable volumes response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isVolume)) {
    throw new Error('Received malformed volumes response. Please contact support.')
  }

  return payload
}

const createInputVolume = async (storageGiB: number): Promise<InputVolume> => {
  const response = await fetch(`${API_BASE}/volumes/inputs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ storage: storageGiB }),
  })

  if (!response.ok) {
    let detail = 'Failed to create input volume. Please try again.'
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail
      }
    } catch {
      // ignore JSON parsing errors in the error branch
    }
    throw new Error(detail)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable volume response. Please try again.')
  }

  if (!isCreateVolumeResponse(payload)) {
    throw new Error('Received malformed volume response. Please contact support.')
  }

  return payload.volume
}

const requestPresignedUrls = async (volumeId: number, fileNames: string[]): Promise<string[]> => {
  const response = await fetch(`${API_BASE}/volumes/inputs/presigneds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ volume_id: volumeId, file_names: fileNames }),
  })

  if (!response.ok) {
    let detail = 'Failed to request upload URLs. Please try again.'
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail
      }
    } catch {
      // ignore JSON parsing errors in the error branch
    }
    throw new Error(detail)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable presigned URL response. Please try again.')
  }

  if (!isPresignedResponse(payload)) {
    throw new Error('Received malformed presigned URL response. Please contact support.')
  }

  return payload.presigneds
}

const InputVolumes = (): JSX.Element => {
  const [storageInput, setStorageInput] = useState<string>(String(DEFAULT_STORAGE_GIB))
  const [createdVolume, setCreatedVolume] = useState<InputVolume | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadStatuses, setUploadStatuses] = useState<UploadStatus[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [presignedUrls, setPresignedUrls] = useState<string[]>([])
  const [fileInputResetKey, setFileInputResetKey] = useState(0)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const inputVolumesQuery = useQuery<InputVolume[], Error>({
    queryKey: ['volumes', 'inputs'],
    queryFn: fetchInputVolumes,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const createVolumeMutation = useMutation<InputVolume, Error, number>({
    mutationFn: createInputVolume,
  })

  const presignedMutation = useMutation<string[], Error, { volumeId: number; fileNames: string[] }>({
    mutationFn: ({ volumeId, fileNames }) => requestPresignedUrls(volumeId, fileNames),
  })

  const isUploading = useMemo(
    () =>
      uploadStatuses.some((status) => status.status === 'uploading') ||
      presignedMutation.isPending ||
      createVolumeMutation.isPending,
    [uploadStatuses, presignedMutation.isPending, createVolumeMutation.isPending],
  )

  const handleOpenCreateModal = () => {
    setIsCreateModalOpen(true)
    setCreatedVolume(null)
    setSelectedFiles([])
    setUploadStatuses([])
    setUploadError(null)
    setPresignedUrls([])
    setFileInputResetKey((prev) => prev + 1)
    createVolumeMutation.reset()
  }

  const handleCloseCreateModal = () => {
    if (isUploading) return
    setIsCreateModalOpen(false)
  }

  const handleModalOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      handleCloseCreateModal()
    }
  }

  const handleStorageChange = (event: ChangeEvent<HTMLInputElement>) => {
    setStorageInput(event.target.value)
  }

  const handleCreateAndUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedStorage = Number(storageInput)
    if (!Number.isFinite(parsedStorage) || parsedStorage <= 0) {
      setUploadError('Storage must be a positive number.')
      return
    }

    if (selectedFiles.length === 0) {
      setUploadError('Select at least one file to upload.')
      return
    }

    const pendingStatuses: UploadStatus[] = selectedFiles.map((file) => ({
      fileName: file.name,
      status: 'pending',
    }))
    setUploadStatuses(pendingStatuses)
    setUploadError(null)
    setPresignedUrls([])

    try {
      const volume = await createVolumeMutation.mutateAsync(parsedStorage)
      setCreatedVolume(volume)
      void queryClient.invalidateQueries({ queryKey: ['volumes', 'inputs'] })

      const urls = await presignedMutation.mutateAsync({
        volumeId: volume.id,
        fileNames: selectedFiles.map((file) => file.name),
      })

      if (urls.length !== selectedFiles.length) {
        throw new Error('The server returned a different number of upload URLs than files selected.')
      }

      setPresignedUrls(urls)

      let hasUploadErrors = false

      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index]
        setUploadStatuses((prev) =>
          prev.map((entry, entryIndex) =>
            entryIndex === index ? { ...entry, status: 'uploading', message: undefined } : entry,
          ),
        )

        try {
          const headers: HeadersInit = {}
          if (file.type) {
            headers['Content-Type'] = file.type
          } else {
            headers['Content-Type'] = 'application/octet-stream'
          }

          const response = await fetch(urls[index], {
            method: 'PUT',
            body: file,
            headers,
            mode: 'cors',
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          })

          if (!response.ok) {
            throw new Error(`Upload failed (${response.status})`)
          }

          setUploadStatuses((prev) =>
            prev.map((entry, entryIndex) =>
              entryIndex === index ? { ...entry, status: 'success', message: undefined } : entry,
            ),
          )
        } catch (error) {
          hasUploadErrors = true
          setUploadStatuses((prev) =>
            prev.map((entry, entryIndex) =>
              entryIndex === index
                ? {
                  ...entry,
                  status: 'error',
                  message: getErrorMessage(
                    error,
                    'Upload failed. If this is a presigned URL CORS issue, verify the bucket CORS config.',
                  ),
                }
                : entry,
            ),
          )
        }
      }

      setFileInputResetKey((prev) => prev + 1)
      if (!hasUploadErrors) {
        setIsCreateModalOpen(false)
      }
    } catch (error) {
      setUploadError(getErrorMessage(error, 'Unable to create volume and upload files right now.'))
      setUploadStatuses((prev) =>
        prev.map((entry) =>
          entry.status === 'success'
            ? entry
            : { ...entry, status: 'error', message: entry.message ?? 'Upload did not complete.' },
        ),
      )
    }
  }

  const handleFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    setSelectedFiles(files)
    setUploadStatuses([])
    setUploadError(null)
    setPresignedUrls([])
  }

  const hasSuccessfulUploads = uploadStatuses.some((status) => status.status === 'success')

  const uploadSummary = (() => {
    if (uploadStatuses.length === 0) return null
    const total = uploadStatuses.length
    const successes = uploadStatuses.filter((status) => status.status === 'success').length
    const failures = uploadStatuses.filter((status) => status.status === 'error').length
    const pending = uploadStatuses.filter((status) => status.status === 'pending').length
    const uploading = uploadStatuses.filter((status) => status.status === 'uploading').length
    return { total, successes, failures, pending, uploading }
  })()

  const volumes = inputVolumesQuery.data ?? []
  const handleRowNavigate = (volumeId: number, volume: InputVolume) => {
    navigate(`/app/input-volumes/${volumeId}`, { state: { volume } })
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, volumeId: number, volume: InputVolume) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowNavigate(volumeId, volume)
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Input Volumes</h1>
          <p>Browse your input volumes, create new ones, and upload files via pre-signed URLs.</p>
        </div>
        <div className={styles.cardActions}>
          <button type="button" className={styles.primaryAction} onClick={handleOpenCreateModal}>
            Create & Upload
          </button>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-label="Input volumes list">

          {inputVolumesQuery.isPending ? <p className={styles.state}>Loading input volumes…</p> : null}

          {inputVolumesQuery.isError ? (
            <p className={`${styles.state} ${styles.stateError}`}>
              {getErrorMessage(inputVolumesQuery.error, 'Failed to load input volumes.')}
            </p>
          ) : null}

          {!inputVolumesQuery.isPending && !inputVolumesQuery.isError ? (
            volumes.length === 0 ? (
              <p className={styles.state}>
                No input volumes available yet. Create a volume to start uploading files.
              </p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <caption className="sr-only">Input volumes</caption>
                  <thead>
                    <tr>
                      <th scope="col">ID</th>
                      <th scope="col">PVC Name</th>
                      <th scope="col">Size (Gi)</th>
                      <th scope="col">Key Prefix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {volumes.length === 0 ? (
                      <tr>
                        <td colSpan={4} className={styles.emptyCell}>
                          No input volumes available.
                        </td>
                      </tr>
                    ) : (
                      volumes.map((volume) => (
                        <tr
                          key={volume.id}
                          className={styles.clickableRow}
                          tabIndex={0}
                          role="link"
                          aria-label={`View details for input volume #${volume.id}`}
                          onClick={() => handleRowNavigate(volume.id, volume)}
                          onKeyDown={(event) => handleRowKeyDown(event, volume.id, volume)}
                        >
                          <td>#{volume.id}</td>
                          <td className={styles.monospace}>{volume.pvc_name}</td>
                          <td>{volume.size}</td>
                          <td className={styles.monospace}>{volume.key_prefix ?? '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </section>
      </div>

      {isCreateModalOpen ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-input-volume-title"
          onClick={handleModalOverlayClick}
        >
          <div className={styles.modal} role="document">
            <header className={styles.modalHeader}>
              <div>
                <h2 id="create-input-volume-title">Create Input Volume</h2>
                <p className={styles.modalDescription}>Provision a new input volume and upload files in one step.</p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleCloseCreateModal}
                aria-label="Close create input volume modal"
                disabled={isUploading}
              >
                ×
              </button>
            </header>

            <form className={styles.form} onSubmit={handleCreateAndUpload}>
              <label className={styles.label}>
                Storage (Gi)
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={storageInput}
                  onChange={handleStorageChange}
                  className={styles.input}
                  required
                  disabled={isUploading}
                />
              </label>

              <label className={styles.label}>
                Files to upload
                <input
                  key={fileInputResetKey}
                  type="file"
                  multiple
                  onChange={handleFilesChange}
                  className={styles.input}
                  disabled={isUploading}
                />
              </label>
              <div className={styles.formNote}>
                Selected: {selectedFiles.length === 0 ? 'No files selected' : `${selectedFiles.length} file(s)`}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={handleCloseCreateModal}
                  disabled={isUploading}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.primaryButton} disabled={isUploading}>
                  {isUploading ? 'Creating & uploading…' : 'Create volume & upload'}
                </button>
              </div>
            </form>

            {uploadError ? <p className={`${styles.state} ${styles.stateError}`}>{uploadError}</p> : null}

            {uploadSummary ? (
              <div className={styles.summary}>
                <strong>Upload summary</strong>
                <span>{uploadSummary.total} file(s) total</span>
                <span>{uploadSummary.successes} succeeded</span>
                <span>{uploadSummary.uploading} uploading</span>
                <span>{uploadSummary.pending} pending</span>
                <span>{uploadSummary.failures} failed</span>
              </div>
            ) : null}

            {uploadStatuses.length > 0 ? (
              <div className={styles.uploadList} role="status">
                {uploadStatuses.map(({ fileName, status, message }) => (
                  <div key={fileName} className={styles.uploadItem}>
                    <div className={styles.uploadMeta}>
                      <span className={styles.monospace}>{fileName}</span>
                      <span className={`${styles.status} ${styles[`status-${status}`]}`}>{status}</span>
                    </div>
                    {message ? <p className={styles.uploadMessage}>{message}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {presignedUrls.length > 0 ? (
              <details className={styles.presignedDetails}>
                <summary>View generated pre-signed URLs</summary>
                <ol className={styles.presignedList}>
                  {presignedUrls.map((url, index) => (
                    <li key={`${url}-${index}`} className={styles.monospace}>
                      {url}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}

            {hasSuccessfulUploads ? (
              <p className={styles.state}>
                Files uploaded successfully{createdVolume ? ` to volume #${createdVolume.id}` : ''}. They should appear
                under the volume prefix.
              </p>
            ) : null}

            {createdVolume ? (
              <dl className={styles.volumeDetails}>
                <div>
                  <dt>Volume ID</dt>
                  <dd className={styles.monospace}>{createdVolume.id}</dd>
                </div>
                <div>
                  <dt>PVC Name</dt>
                  <dd className={styles.monospace}>{createdVolume.pvc_name}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{createdVolume.size} Gi</dd>
                </div>
                <div>
                  <dt>Key Prefix</dt>
                  <dd className={styles.monospace}>{createdVolume.key_prefix ?? '—'}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{createdVolume.is_input ? 'Input' : 'Output'}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default InputVolumes
