import PocketBase from 'pocketbase'

export const PB_URL: string = import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090'

export const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = { id: string; created: string; updated: string; [key: string]: any }

export const uidOwner = () => pb.authStore.record?.id as string
