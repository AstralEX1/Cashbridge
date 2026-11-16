'use client'

import { Toaster as Sonner, ToasterProps } from 'sonner'

// Sonner only places, stacks and times the toasts; every toast is a `TxToastCard` (see `@/lib/toast`).
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    position="bottom-right"
    visibleToasts={4}
    gap={10}
    expand={false}
    offset={{ right: 24, bottom: 24 }}
    mobileOffset={{ right: 16, left: 16, bottom: 16 }}
    toastOptions={{ unstyled: true, classNames: { toast: 'tx-sonner-toast' } }}
    {...props}
  />
)

export { Toaster }
