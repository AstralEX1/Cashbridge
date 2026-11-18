'use client'

import { useTranslations } from 'next-intl'
import { Toaster as Sonner, ToasterProps } from 'sonner'
import { TxToastDismissLabel } from '@/components/tx-toast'

// Sonner only places, stacks and times the toasts; every toast is a `TxToastCard` (see `@/lib/toast`).
// An open Radix dialog sets `pointer-events: none` on the body and the stack inherits it, so without `auto` it would
// neither expand on hover nor take a click on its close button.
const Toaster = ({ ...props }: ToasterProps) => (
  <TxToastDismissLabel.Provider value={useTranslations('common')('close')}>
    <Sonner
      position="bottom-right"
      visibleToasts={5}
      gap={10}
      expand={false}
      offset={{ right: 24, bottom: 24 }}
      mobileOffset={{ right: 16, left: 16, bottom: 16 }}
      style={{ pointerEvents: 'auto' }}
      toastOptions={{ unstyled: true, classNames: { toast: 'tx-sonner-toast' } }}
      {...props}
    />
  </TxToastDismissLabel.Provider>
)

export { Toaster }
