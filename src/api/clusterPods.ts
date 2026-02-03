import { GPU_PROFILE_ORDER, getProfileOrder, type GPUProfile } from '../constants/gpuProfiles'

const API_BASE = import.meta.env.VITE_API_BASE;

export type PodPriority = 'low' | 'medium' | 'high' | 'extra-high'

const POD_PRIORITIES: PodPriority[] = ['low', 'medium', 'high', 'extra-high']

const isPodPriority = (value: unknown): value is PodPriority =>
  typeof value === 'string' && POD_PRIORITIES.includes(value as PodPriority)

export type ClusterPod = {
  name: string
  namespace: string
  status: string
  gpu: GPUProfile
  priority: PodPriority
  start_time: string | null
  finish_time: string | null
}

const isClusterPod = (value: unknown): value is ClusterPod => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>

  const name = record.name
  const namespace = record.namespace
  const status = record.status
  const gpu = record.gpu
  const priority = record.priority
  const startTime = record.start_time
  const finishTime = record.finish_time

  const isGpuProfile = typeof gpu === 'string' && GPU_PROFILE_ORDER.has(gpu as GPUProfile)
  const isDateValue = (input: unknown) => input === null || typeof input === 'string'

  return (
    typeof name === 'string' &&
    name.length > 0 &&
    typeof namespace === 'string' &&
    namespace.length > 0 &&
    typeof status === 'string' &&
    status.length > 0 &&
    isGpuProfile &&
    isPodPriority(priority) &&
    isDateValue(startTime) &&
    isDateValue(finishTime)
  )
}

export const fetchClusterPods = async (): Promise<ClusterPod[]> => {
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

  return payload.sort((a, b) => getProfileOrder(a.gpu) - getProfileOrder(b.gpu))
}
