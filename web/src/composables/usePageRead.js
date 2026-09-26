import { onBeforeUnmount } from 'vue'
import { request } from '../api'

// Reads belong to the page that requested them; release their connections on navigation.
export function usePageRead() {
  const controller = new AbortController()
  onBeforeUnmount(() => controller.abort())
  return path => request(path, { signal: controller.signal })
}
