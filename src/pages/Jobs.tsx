import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, JSX, KeyboardEvent, MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSecretDetail, fetchSecrets, type SecretSummary } from '../api/secrets'
import { GPU_PROFILES, type GPUProfile } from '../constants/gpuProfiles'
import styles from './Jobs.module.css'

const API_BASE = import.meta.env.VITE_API_BASE;
const JOBS_STALE_TIME_MS = 5_000
const JOBS_REFETCH_INTERVAL_MS = 5_000
const JOB_IMAGES_STALE_TIME_MS = 60_000

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

type JobImageOption = {
  image: string
  tag: string
  digest: string
  pushed_at: string
}

type JobPriority = 'low' | 'medium' | 'high' | 'extra_high'

type JobSubmissionPayload = {
  image: string
  gpu: GPUProfile
  storage: number
  priority: JobPriority
  secretNames: string[]
  inputId: number | null
}

type InputVolume = {
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

const DEFAULT_STORAGE_GB = 1
const SUCCESS_MESSAGE_TIMEOUT_MS = 4_000
const DEFAULT_GPU_PROFILE = (GPU_PROFILES.find((profile) => profile === '1g.10gb') ?? GPU_PROFILES[0]) as GPUProfile
const DEFAULT_PRIORITY: JobPriority = 'medium'
const SECRETS_STALE_TIME_MS = 60_000
const SECRET_DETAILS_STALE_TIME_MS = 60_000
const INPUT_VOLUMES_STALE_TIME_MS = 15_000
const INPUT_VOLUME_OBJECTS_MAX_KEYS = 50
const JOB_PRIORITIES: JobPriority[] = ['low', 'medium', 'high', 'extra_high']
const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  extra_high: 'Extra high',
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

const isJobImageOption = (value: unknown): value is JobImageOption => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  return (
    typeof record.image === 'string' &&
    typeof record.tag === 'string' &&
    typeof record.digest === 'string' &&
    typeof record.pushed_at === 'string'
  )
}

const fetchJobImages = async (): Promise<JobImageOption[]> => {
  const response = await fetch(`${API_BASE}/jobs/images`, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    let detail = 'Failed to load job images. Please try again.'
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
      // ignore JSON parsing errors from error responses
    }
    throw new Error(detail)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Received unreadable job images response. Please try again.')
  }

  if (!Array.isArray(payload) || !payload.every(isJobImageOption)) {
    throw new Error('Received malformed job images response. Please contact support.')
  }

  return payload
}

const isInputVolume = (value: unknown): value is InputVolume => {
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

  if (!Array.isArray(payload) || !payload.every(isInputVolume)) {
    throw new Error('Received malformed volumes response. Please contact support.')
  }

  return payload
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

const fetchInputVolumeObjects = async (volumeId: number): Promise<VolumeObjectsResponse> => {
  const params = new URLSearchParams({ max_keys: String(INPUT_VOLUME_OBJECTS_MAX_KEYS) })
  const response = await fetch(`${API_BASE}/volumes/${volumeId}/objects?${params.toString()}`, {
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
  const queryClient = useQueryClient()

  const jobsQuery = useQuery<JobRecord[], Error>({
    queryKey: ['jobs', 'list'],
    queryFn: fetchJobs,
    staleTime: JOBS_STALE_TIME_MS,
    refetchInterval: JOBS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const jobImagesQuery = useQuery<JobImageOption[], Error>({
    queryKey: ['jobs', 'images'],
    queryFn: fetchJobImages,
    staleTime: JOB_IMAGES_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })

  const secretsQuery = useQuery<SecretSummary[], Error>({
    queryKey: ['secrets', 'list'],
    queryFn: fetchSecrets,
    staleTime: SECRETS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })

  const inputVolumesQuery = useQuery<InputVolume[], Error>({
    queryKey: ['volumes', 'inputs'],
    queryFn: fetchInputVolumes,
    staleTime: INPUT_VOLUMES_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })

  const [imageInput, setImageInput] = useState('')
  const [gpuProfile, setGpuProfile] = useState<GPUProfile>(DEFAULT_GPU_PROFILE)
  const [priority, setPriority] = useState<JobPriority>(DEFAULT_PRIORITY)
  const [storageInput, setStorageInput] = useState(String(DEFAULT_STORAGE_GB))
  const [selectedSecretNames, setSelectedSecretNames] = useState<string[]>([])
  const [selectedInputVolumeId, setSelectedInputVolumeId] = useState<number | null>(null)
  const [volumePreviewId, setVolumePreviewId] = useState<number | null>(null)
  const [isVolumesModalOpen, setIsVolumesModalOpen] = useState(false)
  const [volumeSearchTerm, setVolumeSearchTerm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isRegistryModalOpen, setIsRegistryModalOpen] = useState(false)
  const [registrySearchTerm, setRegistrySearchTerm] = useState('')

  const createJobMutation = useMutation<void, Error, JobSubmissionPayload>({
    mutationFn: async ({ image, gpu, storage, priority, secretNames, inputId }) => {
      const payload: Record<string, unknown> = { image, gpu, storage, priority }
      if (secretNames.length > 0) {
        payload.secret_names = secretNames
      }
      if (typeof inputId === 'number') {
        payload.input_id = inputId
      }

      const response = await fetch(`${API_BASE}/jobs/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        let detail = `Failed to submit job (status ${response.status}).`
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
          // ignore JSON parsing errors from error responses
        }
        throw new Error(detail)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['jobs', 'list'] })
    },
  })

  const jobs = jobsQuery.data ?? []
  const jobImageOptions = useMemo(() => jobImagesQuery.data ?? [], [jobImagesQuery.data])
  const availableSecrets = secretsQuery.data ?? []
  const inputVolumeOptions = inputVolumesQuery.data ?? []
  const selectedInputVolume = useMemo(
    () => inputVolumeOptions.find((volume) => volume.id === selectedInputVolumeId) ?? null,
    [inputVolumeOptions, selectedInputVolumeId],
  )
  const previewVolume = useMemo(
    () => inputVolumeOptions.find((volume) => volume.id === volumePreviewId) ?? null,
    [inputVolumeOptions, volumePreviewId],
  )
  const filteredInputVolumeOptions = useMemo(() => {
    const term = volumeSearchTerm.trim().toLowerCase()
    if (!term) return inputVolumeOptions
    return inputVolumeOptions.filter((volume) => {
      const pvc = volume.pvc_name.toLowerCase()
      const id = String(volume.id)
      const prefix = volume.key_prefix?.toLowerCase() ?? ''
      return pvc.includes(term) || prefix.includes(term) || id.includes(term)
    })
  }, [inputVolumeOptions, volumeSearchTerm])
  const isSubmittingJob = createJobMutation.isPending
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const registrySearchInputRef = useRef<HTMLInputElement | null>(null)
  const trimmedImageInput = imageInput.trim()
  const filteredRegistryOptions = useMemo(() => {
    const query = registrySearchTerm.trim().toLowerCase()
    if (!query) return jobImageOptions
    return jobImageOptions.filter((option) => {
      const image = option.image.toLowerCase()
      const tag = option.tag.toLowerCase()
      return image.includes(query) || tag.includes(query)
    })
  }, [jobImageOptions, registrySearchTerm])
  const isRegistryAvailable = jobImageOptions.length > 0
  useEffect(() => {
    if (!isVolumesModalOpen) return
    if (typeof selectedInputVolumeId === 'number') {
      setVolumePreviewId(selectedInputVolumeId)
      return
    }
    const firstOption = inputVolumeOptions[0]
    setVolumePreviewId(firstOption ? firstOption.id : null)
  }, [inputVolumeOptions, isVolumesModalOpen, selectedInputVolumeId])

  const volumeObjectsQuery = useQuery<VolumeObjectsResponse, Error>({
    queryKey: ['volumes', 'objects', 'preview', volumePreviewId],
    queryFn: () => fetchInputVolumeObjects(volumePreviewId as number),
    staleTime: INPUT_VOLUMES_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    enabled: isVolumesModalOpen && typeof volumePreviewId === 'number',
  })
  const previewObjects = volumeObjectsQuery.data?.objects ?? []
  const previewObjectsTruncated = volumeObjectsQuery.data?.truncated ?? false
  const previewPrefix =
    volumeObjectsQuery.data?.prefix ?? (previewVolume ? previewVolume.key_prefix ?? null : null)
  const selectedSecretDetailQueries = useQueries({
    queries: selectedSecretNames.map((secretName) => ({
      queryKey: ['secrets', 'detail', secretName],
      queryFn: () => fetchSecretDetail(secretName),
      staleTime: SECRET_DETAILS_STALE_TIME_MS,
      refetchOnWindowFocus: false,
      enabled: isModalOpen,
    })),
  })
  const selectedSecretDetails = selectedSecretNames.map((secretName, index) => ({
    secretName,
    query: selectedSecretDetailQueries[index],
  }))

  useEffect(() => {
    if (!successMessage) return undefined
    const timerId = window.setTimeout(() => {
      setSuccessMessage(null)
    }, SUCCESS_MESSAGE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [successMessage])

  useEffect(() => {
    if (!isModalOpen) return
    window.setTimeout(() => {
      imageInputRef.current?.focus()
    }, 0)
  }, [isModalOpen])

  useEffect(() => {
    if (!isRegistryModalOpen) return
    window.setTimeout(() => {
      registrySearchInputRef.current?.focus()
    }, 0)
  }, [isRegistryModalOpen])

  const getStatusClassName = (status: string): string => {
    const key = getStatusStyleKey(status)
    const modifier = styles[key] ?? styles.unknown
    return `${styles.statusBadge} ${modifier}`.trim()
  }

  const imageHintMessage = jobImagesQuery.isPending
    ? 'Loading registry images…'
    : jobImagesQuery.isError
      ? `Registry suggestions unavailable: ${getErrorMessage(jobImagesQuery.error)}`
      : 'Provide an image reference or browse the registry.';

  const imageHintClassName = jobImagesQuery.isError
    ? `${styles.fieldHint} ${styles.fieldHintError}`.trim()
    : styles.fieldHint

  const resetFormState = () => {
    setFormError(null)
    setGpuProfile(DEFAULT_GPU_PROFILE)
    setPriority(DEFAULT_PRIORITY)
    setStorageInput(String(DEFAULT_STORAGE_GB))
    setImageInput('')
    setSelectedSecretNames([])
    setSelectedInputVolumeId(null)
    setVolumePreviewId(null)
    setVolumeSearchTerm('')
    setRegistrySearchTerm('')
    setIsRegistryModalOpen(false)
    setIsVolumesModalOpen(false)
  }

  const handleOpenModal = () => {
    resetFormState()
    createJobMutation.reset()
    setIsModalOpen(true)
    if (successMessage) setSuccessMessage(null)
  }

  const handleCloseModal = () => {
    if (isSubmittingJob) return
    setIsModalOpen(false)
    setIsRegistryModalOpen(false)
    setFormError(null)
  }

  const handleOverlayClick = () => {
    if (isSubmittingJob) return
    handleCloseModal()
  }

  const handleModalClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setImageInput(event.target.value)
    if (formError) setFormError(null)
    if (successMessage) setSuccessMessage(null)
  }

  const handleOpenRegistryModal = () => {
    if (jobImagesQuery.isError || jobImagesQuery.isPending) return
    if (jobImageOptions.length === 0) return
    setRegistrySearchTerm('')
    setIsRegistryModalOpen(true)
  }

  const handleCloseRegistryModal = () => {
    setIsRegistryModalOpen(false)
  }

  const handleRegistrySearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRegistrySearchTerm(event.target.value)
  }

  const handleRegistryOptionSelect = (value: string) => {
    setImageInput(value)
    setIsRegistryModalOpen(false)
    if (formError) setFormError(null)
    if (successMessage) setSuccessMessage(null)
    window.setTimeout(() => {
      imageInputRef.current?.focus()
    }, 0)
  }

  const handleGpuChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setGpuProfile(event.target.value as GPUProfile)
    if (successMessage) setSuccessMessage(null)
  }

  const handlePriorityChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setPriority(event.target.value as JobPriority)
    if (successMessage) setSuccessMessage(null)
  }

  const handleStorageChange = (event: ChangeEvent<HTMLInputElement>) => {
    setStorageInput(event.target.value)
    if (formError) setFormError(null)
    if (successMessage) setSuccessMessage(null)
  }

  const handleOpenVolumesModal = () => {
    setIsVolumesModalOpen(true)
    setVolumeSearchTerm('')
    setFormError(null)
    if (successMessage) setSuccessMessage(null)
  }

  const handleCloseVolumesModal = () => {
    setIsVolumesModalOpen(false)
  }

  const handleVolumeSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setVolumeSearchTerm(event.target.value)
  }

  const handleVolumePreviewSelect = (volumeId: number) => {
    setVolumePreviewId(volumeId)
  }

  const handleConfirmVolumeSelection = () => {
    if (typeof volumePreviewId !== 'number') return
    setSelectedInputVolumeId(volumePreviewId)
    setIsVolumesModalOpen(false)
  }

  const handleSecretToggle = (event: ChangeEvent<HTMLInputElement>, secretName: string) => {
    const { checked } = event.target
    setSelectedSecretNames((prev) => {
      if (checked) {
        if (prev.includes(secretName)) return prev
        return [...prev, secretName]
      }
      return prev.filter((name) => name !== secretName)
    })
    if (successMessage) setSuccessMessage(null)
  }

  const handleJobSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmittingJob) return

    const trimmedImage = trimmedImageInput
    if (!trimmedImage) {
      setFormError('Image is required.')
      return
    }

    const parsedStorage = Number(storageInput)
    if (!Number.isInteger(parsedStorage) || parsedStorage < 1) {
      setFormError('Storage must be a positive whole number.')
      return
    }

    try {
      await createJobMutation.mutateAsync({
        image: trimmedImage,
        gpu: gpuProfile,
        storage: parsedStorage,
        priority,
        secretNames: selectedSecretNames,
        inputId: selectedInputVolumeId,
      })
      setSuccessMessage('Job submitted successfully.')
      setIsModalOpen(false)
      setIsRegistryModalOpen(false)
      setFormError(null)
      setSelectedInputVolumeId(null)
      setSelectedSecretNames([])
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Failed to submit job. Please try again.'
      setFormError(message)
      setSuccessMessage(null)
    }
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
          <button type="button" className={styles.primaryAction} onClick={handleOpenModal}>
            Submit Job
          </button>
        </div>

        {successMessage ? (
          <div className={`${styles.formFeedback} ${styles.formFeedbackSuccess}`} role="status" aria-live="polite">
            {successMessage}
          </div>
        ) : null}

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

        {isModalOpen ? (
          <div className={styles.modalOverlay} onClick={handleOverlayClick}>
            <div
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="submit-job-modal-title"
              onClick={handleModalClick}
            >
              <header className={styles.modalHeader}>
                <div>
                  <h2 id="submit-job-modal-title">Submit Job</h2>
                  <p className={styles.modalDescription}>
                    Define the runtime image, priority, GPU profile, storage requirements, and optional input volume for your workload.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={handleCloseModal}
                  disabled={isSubmittingJob}
                  aria-label="Close submit job modal"
                >
                  ×
                </button>
              </header>

              {formError ? (
                <div className={`${styles.formFeedback} ${styles.formFeedbackError}`} role="alert">
                  {formError}
                </div>
              ) : null}

              <form className={styles.jobForm} onSubmit={handleJobSubmit} noValidate>
                <div className={styles.modalBody}>
                  <div className={styles.formGrid}>
                  <label className={`${styles.formField} ${styles.fullWidthField}`}>
                    <span className={styles.fieldLabel}>Container image</span>
                    <div className={styles.imageFieldRow}>
                      <input
                        ref={imageInputRef}
                        type="text"
                        name="image"
                        value={imageInput}
                        onChange={handleImageInputChange}
                        className={styles.fieldControl}
                        placeholder="registry/repository:tag"
                        autoComplete="off"
                        disabled={isSubmittingJob}
                        required
                      />
                      <button
                        type="button"
                        className={styles.registryButton}
                        onClick={handleOpenRegistryModal}
                        disabled={
                          isSubmittingJob || !isRegistryAvailable || jobImagesQuery.isPending || jobImagesQuery.isError
                        }
                      >
                        Browse Registry
                      </button>
                    </div>
                    <span className={imageHintClassName}>{imageHintMessage}</span>
                  </label>

                  <label className={styles.formField}>
                    <span className={styles.fieldLabel}>GPU profile</span>
                    <select
                      name="gpu"
                      value={gpuProfile}
                      onChange={handleGpuChange}
                      className={styles.fieldControl}
                      disabled={isSubmittingJob}
                      required
                    >
                      {GPU_PROFILES.map((profile) => (
                        <option key={profile} value={profile}>
                          {profile}
                        </option>
                      ))}
                    </select>
                    <span className={styles.fieldHint}>MiG slice that will be requested for the job.</span>
                  </label>

                  <label className={styles.formField}>
                    <span className={styles.fieldLabel}>Priority</span>
                    <select
                      name="priority"
                      value={priority}
                      onChange={handlePriorityChange}
                      className={styles.fieldControl}
                      disabled={isSubmittingJob}
                      required
                    >
                      {JOB_PRIORITIES.map((option) => (
                        <option key={option} value={option}>
                          {PRIORITY_LABELS[option]}
                        </option>
                      ))}
                    </select>
                    <span className={styles.fieldHint}>Scheduling importance for this job.</span>
                  </label>

                  <label className={styles.formField}>
                    <span className={styles.fieldLabel}>Storage (GB)</span>
                    <input
                      type="number"
                      name="storage"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={storageInput}
                      onChange={handleStorageChange}
                      className={styles.fieldControl}
                      placeholder={String(DEFAULT_STORAGE_GB)}
                      disabled={isSubmittingJob}
                      required
                    />
                    <span className={styles.fieldHint}>Requested storage capacity for the job output.</span>
                  </label>

                  <label className={`${styles.formField} ${styles.fullWidthField}`}>
                    <span className={styles.fieldLabel}>Input volume (optional)</span>
                    <span className={styles.fieldHint}>
                      Attach an existing input volume and inspect its objects before selecting it.
                    </span>
                    <div className={styles.volumePickerRow}>
                      <button
                        type="button"
                        className={styles.volumeBrowseButton}
                        onClick={handleOpenVolumesModal}
                        disabled={isSubmittingJob || inputVolumesQuery.isPending}
                      >
                        Browse input volumes
                      </button>
                      <span
                        className={
                          inputVolumesQuery.isError
                            ? `${styles.fieldHint} ${styles.fieldHintError}`
                            : styles.fieldHint
                        }
                      >
                        {inputVolumesQuery.isPending
                          ? 'Loading input volumes…'
                          : inputVolumesQuery.isError
                            ? `Failed to load volumes: ${getErrorMessage(inputVolumesQuery.error)}`
                            : selectedInputVolume
                              ? `Selected #${selectedInputVolume.id} (${selectedInputVolume.pvc_name})`
                              : 'No volume selected.'}
                      </span>
                    </div>

                    {selectedInputVolume ? (
                      <div className={styles.inputVolumePreview}>
                        <div className={styles.inputVolumeSummary}>
                          <div className={styles.inputVolumeTitle}>
                            #{selectedInputVolume.id} · {selectedInputVolume.pvc_name}
                          </div>
                          <div className={styles.inputVolumeMeta}>
                            Size: {selectedInputVolume.size} Gi · Prefix:{' '}
                            <span className={styles.monospace}>{selectedInputVolume.key_prefix ?? '—'}</span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </label>

                    <div className={`${styles.formField} ${styles.fullWidthField}`}>
                      <span className={styles.fieldLabel}>Secrets (optional)</span>
                      <span className={styles.fieldHint}>Attach managed secrets that should be available to this job.</span>

                      {secretsQuery.isPending ? (
                        <p className={styles.secretFieldStatus}>Loading secrets…</p>
                      ) : secretsQuery.isError ? (
                        <p className={`${styles.secretFieldStatus} ${styles.secretFieldStatusError}`}>
                          Failed to load secrets: {getErrorMessage(secretsQuery.error)}
                        </p>
                      ) : availableSecrets.length === 0 ? (
                        <p className={styles.fieldHint}>No secrets are available to attach.</p>
                      ) : (
                        <div className={styles.secretList} role="group" aria-label="Available secrets">
                          {availableSecrets.map(({ name }) => {
                            const isChecked = selectedSecretNames.includes(name)
                            return (
                              <label key={name} className={styles.secretOption}>
                                <input
                                  type="checkbox"
                                  value={name}
                                  checked={isChecked}
                                  onChange={(event) => handleSecretToggle(event, name)}
                                  disabled={isSubmittingJob}
                                />
                                <span className={styles.secretOptionName}>{name}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}

                      {selectedSecretNames.length > 0 ? (
                        <div className={styles.selectedSecrets}>
                          <span className={styles.selectedSecretsHeading}>Selected secrets</span>
                          <ul className={styles.selectedSecretsList}>
                            {selectedSecretDetails.map(({ secretName, query }) => {
                              const detailQuery = query ?? null
                              return (
                                <li key={secretName} className={styles.selectedSecretItem}>
                                  <div className={styles.selectedSecretHeader}>
                                    <span className={styles.secretOptionName}>{secretName}</span>
                                  </div>
                                  {detailQuery?.isPending ? (
                                    <span className={styles.secretMeta}>Loading keys…</span>
                                  ) : detailQuery?.isError ? (
                                    <span className={`${styles.secretMeta} ${styles.secretMetaError}`}>
                                      Failed to load keys: {getErrorMessage(detailQuery.error)}
                                    </span>
                                  ) : detailQuery?.data && detailQuery.data.keys.length > 0 ? (
                                    <ul className={styles.secretKeysList}>
                                      {detailQuery.data.keys.map((key) => (
                                        <li key={key} className={styles.secretKeyPill}>
                                          {key}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className={styles.secretMeta}>No keys configured.</span>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <footer className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={handleCloseModal}
                    disabled={isSubmittingJob}
                  >
                    Cancel
                  </button>
                  <button type="submit" className={styles.submitButton} disabled={isSubmittingJob}>
                    {isSubmittingJob ? 'Submitting…' : 'Submit Job'}
                  </button>
                </footer>
              </form>
            </div>
          </div>
        ) : null}
      </section>

      {isRegistryModalOpen ? (
        <div
          className={styles.registryModalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="registry-modal-title"
          onClick={handleCloseRegistryModal}
        >
          <div className={styles.registryModal} onClick={(event) => event.stopPropagation()}>
            <header className={styles.registryHeader}>
              <h3 id="registry-modal-title">Browse Registry Images</h3>
              <button
                type="button"
                className={styles.registryCloseButton}
                onClick={handleCloseRegistryModal}
                aria-label="Close registry browser"
              >
                ×
              </button>
            </header>

            <div className={styles.registryBody}>
              <div className={styles.registrySearch}>
                <label htmlFor="registry-image-search">Filter images</label>
                <input
                  id="registry-image-search"
                  ref={registrySearchInputRef}
                  type="search"
                  value={registrySearchTerm}
                  placeholder="Search by tag or image name"
                  onChange={handleRegistrySearchChange}
                />
              </div>

              {jobImagesQuery.isPending ? (
                <p className={styles.registryStatus}>Loading registry images…</p>
              ) : jobImagesQuery.isError ? (
                <p className={`${styles.registryStatus} ${styles.registryStatusError}`}>
                  {getErrorMessage(jobImagesQuery.error)}
                </p>
              ) : filteredRegistryOptions.length === 0 ? (
                <p className={styles.registryEmpty}>No registry images match your search.</p>
              ) : (
                <div className={styles.registryScrollArea}>
                  <ul className={styles.registryList}>
                    {filteredRegistryOptions.map((option) => {
                      const truncatedDigest = option.digest.startsWith('sha256:')
                        ? option.digest.slice(7, 19)
                        : option.digest.slice(0, 12)
                      return (
                        <li key={option.image} className={styles.registryItem}>
                          <button
                            type="button"
                            className={styles.registrySelectButton}
                            onClick={() => handleRegistryOptionSelect(option.image)}
                          >
                            <span className={styles.registryPrimary}>{option.tag || 'untagged'}</span>
                            <span className={styles.registrySecondary}>{option.image}</span>
                            <span className={styles.registryMeta}>Digest: {truncatedDigest}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isVolumesModalOpen ? (
        <div
          className={styles.volumeModalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="volume-modal-title"
          onClick={handleCloseVolumesModal}
        >
          <div className={styles.volumeModal} onClick={(event) => event.stopPropagation()}>
            <header className={styles.volumeHeader}>
              <h3 id="volume-modal-title">Browse Input Volumes</h3>
              <button
                type="button"
                className={styles.volumeCloseButton}
                onClick={handleCloseVolumesModal}
                aria-label="Close input volume browser"
              >
                ×
              </button>
            </header>

            <div className={styles.volumeBody}>
              <div className={styles.volumeSearch}>
                <label htmlFor="volume-search">Filter volumes</label>
                <input
                  id="volume-search"
                  type="search"
                  value={volumeSearchTerm}
                  placeholder="Search by ID, PVC name, or key prefix"
                  onChange={handleVolumeSearchChange}
                />
              </div>

              {inputVolumesQuery.isPending ? (
                <p className={styles.volumeStatus}>Loading input volumes…</p>
              ) : inputVolumesQuery.isError ? (
                <p className={`${styles.volumeStatus} ${styles.volumeStatusError}`}>
                  Failed to load volumes: {getErrorMessage(inputVolumesQuery.error)}
                </p>
              ) : filteredInputVolumeOptions.length === 0 ? (
                <p className={styles.volumeStatus}>No input volumes match your search.</p>
              ) : (
                <div className={styles.volumeBrowser}>
                  <div className={styles.volumeList} role="listbox" aria-label="Available input volumes">
                    {filteredInputVolumeOptions.map((volume) => {
                      const isActive = volume.id === volumePreviewId
                      return (
                        <button
                          key={volume.id}
                          type="button"
                          className={`${styles.volumeListButton} ${isActive ? styles.volumeListButtonActive : ''}`.trim()}
                          onClick={() => handleVolumePreviewSelect(volume.id)}
                          aria-pressed={isActive}
                        >
                          <span className={styles.volumeListTitle}>
                            #{volume.id} · {volume.pvc_name}
                          </span>
                          <span className={styles.volumeListMeta}>
                            {volume.size} Gi · Prefix:{' '}
                            <span className={styles.monospace}>{volume.key_prefix ?? '—'}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  <div className={styles.volumePreviewPanel}>
                    {!previewVolume ? (
                      <p className={styles.volumeStatus}>Select a volume to preview its objects.</p>
                    ) : (
                      <>
                        <div className={styles.volumePreviewHeader}>
                          <div>
                            <div className={styles.volumePreviewTitle}>
                              #{previewVolume.id} · {previewVolume.pvc_name}
                            </div>
                            <div className={styles.volumePreviewMeta}>
                              Size: {previewVolume.size} Gi · Prefix:{' '}
                              <span className={styles.monospace}>{previewPrefix ?? '—'}</span>
                            </div>
                          </div>
                        </div>

                        <div className={styles.volumeObjects}>
                          <div className={styles.volumeObjectsHeading}>
                            <span>Objects</span>
                            {previewObjectsTruncated ? <span className={styles.volumeBadge}>Limited view</span> : null}
                          </div>
                          {volumeObjectsQuery.isPending ? (
                            <p className={styles.volumeStatus}>Loading objects…</p>
                          ) : volumeObjectsQuery.isError ? (
                            <p className={`${styles.volumeStatus} ${styles.volumeStatusError}`}>
                              Failed to load objects: {getErrorMessage(volumeObjectsQuery.error)}
                            </p>
                          ) : previewObjects.length === 0 ? (
                            <p className={styles.volumeStatus}>No objects found for this volume.</p>
                          ) : (
                            <ul className={styles.volumeObjectsList}>
                              {previewObjects.map((object) => (
                                <li key={object.key} className={styles.volumeObjectRow}>
                                  <div className={styles.volumeObjectKey}>{object.key}</div>
                                  <div className={styles.volumeObjectMeta}>
                                    <span>{formatFileSize(object.size)}</span>
                                    <span aria-hidden="true">•</span>
                                    <span>{formatDateTime(object.last_modified)}</span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                          {previewObjectsTruncated ? (
                            <p className={styles.volumeStatus}>Showing the first {INPUT_VOLUME_OBJECTS_MAX_KEYS} objects.</p>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <footer className={styles.volumeFooter}>
              <button type="button" className={styles.secondaryAction} onClick={handleCloseVolumesModal}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.submitButton}
                onClick={handleConfirmVolumeSelection}
                disabled={!previewVolume}
              >
                Confirm volume
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default Jobs
