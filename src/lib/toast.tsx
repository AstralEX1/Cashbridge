import type { ReactNode } from 'react'
import { toast as sonner } from 'sonner'
import { TxToastCard, type TxToastStatus } from '@/components/tx-toast'

// The site's toasts: sonner places and stacks them, the card is the same one the progress screen uses.
// Loading and error toasts stay until dismissed (or replaced under the same id), the rest leave after 5 s.
type Id = string | number
interface Options {
  id?: Id
  description?: ReactNode
  icon?: ReactNode
  duration?: number
  // An explorer link under the text.
  actionLabel?: string
  actionHref?: string
  dismissLabel?: string
  // Called when the toast is closed (its button, a swipe or `toast.dismiss`), not when it times out.
  onDismiss?: () => void
}

const show = (status: TxToastStatus, title: ReactNode, { id, description, icon, duration, actionLabel, actionHref, dismissLabel, onDismiss }: Options = {}): Id =>
  sonner.custom(
    toastId => (
      <TxToastCard
        status={status}
        title={title}
        description={description}
        icon={icon}
        actionLabel={actionLabel}
        actionHref={actionHref}
        dismissLabel={dismissLabel}
        onDismiss={() => sonner.dismiss(toastId)}
      />
    ),
    {
      ...(id === undefined ? {} : { id }),
      onDismiss,
      duration: duration ?? (status === 'loading' || status === 'error' ? Infinity : 5000)
    }
  )

// `toast(message)` alone is a plain info toast.
export const toast = Object.assign((title: ReactNode, options?: Options) => show('info', title, options), {
  loading: (title: ReactNode, options?: Options) => show('loading', title, options),
  success: (title: ReactNode, options?: Options) => show('success', title, options),
  error: (title: ReactNode, options?: Options) => show('error', title, options),
  warning: (title: ReactNode, options?: Options) => show('warning', title, options),
  info: (title: ReactNode, options?: Options) => show('info', title, options),
  dismiss: (id?: Id) => sonner.dismiss(id),
  // One toast that turns from loading into success or error when the promise settles.
  promise: <T,>(promise: Promise<T>, messages: { loading: string; success: string | ((value: T) => string); error: string | ((error: unknown) => string) }) => {
    const id = show('loading', messages.loading)
    promise.then(
      value => show('success', typeof messages.success === 'function' ? messages.success(value) : messages.success, { id }),
      (error: unknown) => show('error', typeof messages.error === 'function' ? messages.error(error) : messages.error, { id })
    )
    return id
  }
})
