const GPU_PROFILES = ['1g.10gb', '2g.20gb', '3g.40gb', '4g.40gb', '7g.79gb'] as const

export type GPUProfile = (typeof GPU_PROFILES)[number]

const GPU_PROFILE_ORDER = new Map(GPU_PROFILES.map((profile, index) => [profile, index]))

export const getProfileOrder = (profile: GPUProfile): number => GPU_PROFILE_ORDER.get(profile) ?? GPU_PROFILES.length

export const formatGpuLabel = (gpu: GPUProfile): string => gpu.replace(/gb$/i, '')

export { GPU_PROFILES, GPU_PROFILE_ORDER }
