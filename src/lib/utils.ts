import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Radix closes a modal on any pointer or focus event outside it; a click on a toast must not close the dialog under it.
export function fromToast(event: Event) {
  return event.target instanceof Element && !!event.target.closest('[data-sonner-toaster]')
}

export function toCurrencyFixed(value: string): string {
  if (!value.includes('.')) return value + '.00'
  const dot = value.indexOf('.')
  const dec = value.slice(dot + 1)
  if (dec.length === 1) return value + '0'
  return value
}

export function truncate(text: string, maxLength: number = 15) {
  if (text.length <= maxLength) return text

  const separator = '...'

  const sepLen = separator.length,
    charsToShow = maxLength - sepLen,
    frontChars = Math.ceil(charsToShow / 2),
    backChars = Math.floor(charsToShow / 2)

  return text.substring(0, frontChars) + separator + text.substring(text.length - backChars)
}

export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}
