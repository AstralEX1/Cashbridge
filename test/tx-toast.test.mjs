import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TxToastCard, TxToastDismissLabel } from '../src/components/tx-toast.tsx'
import { fromToast } from '../src/lib/utils.ts'

const token = createElement('img', { src: '/tokens/pusd.svg', alt: '' })
const render = props => renderToStaticMarkup(createElement(TxToastCard, { title: 'PUSD swap sent', ...props }))

test('a pending transaction turns a ring around its token and has no badge', () => {
  const html = render({ status: 'loading', icon: token, description: 'Confirming on chain' })
  assert.match(html, /class="tx-toast"/)
  assert.match(html, /tx-toast-ring/)
  assert.match(html, /<svg class="tx-toast-spinner"/)
  assert.match(html, /<img src="\/tokens\/pusd\.svg"/)
  assert.doesNotMatch(html, /tx-toast-badge|tx-toast-burst/)
  assert.match(html, /role="status"/)
})

test('a finished transaction fills the ring and lands a check badge on the token', () => {
  const html = render({ status: 'success', icon: token, description: 'Transaction complete' })
  assert.doesNotMatch(html, /tx-toast-spinner/)
  assert.match(html, /tx-toast-badge/)
  assert.match(html, /tx-toast-burst/)
  assert.match(html, /rgba\(60,200,140,0\.35\)/)
  assert.match(html, /Transaction complete/)
})

test('without a token each status draws its own glyph, and errors are announced as alerts', () => {
  assert.match(render({ status: 'loading' }), /tx-toast-icon is-loading/)
  assert.match(render({ status: 'success' }), /tx-toast-icon is-success/)
  const error = render({ status: 'error' })
  assert.match(error, /tx-toast-icon is-error/)
  assert.match(error, /class="tx-toast is-error"/)
  assert.match(error, /role="alert"/)
})

test('the explorer link and the dismiss button only exist when given, and leaving adds the exit class', () => {
  assert.doesNotMatch(render({ status: 'success' }), /tx-toast-action|tx-toast-dismiss/)
  const html = render({ status: 'success', actionLabel: 'View on explorer', actionHref: 'https://example.com/tx/1', dismissLabel: 'Dismiss', onDismiss() {}, leaving: true })
  assert.match(html, /href="https:\/\/example\.com\/tx\/1" target="_blank" rel="noopener noreferrer"/)
  assert.match(html, /aria-label="Dismiss"/)
  assert.match(html, /class="tx-toast is-leaving"/)
})

test('the close button falls back to the label the toaster provides', () => {
  const html = renderToStaticMarkup(
    createElement(TxToastDismissLabel.Provider, { value: 'Close' }, createElement(TxToastCard, { status: 'error', title: 'Failed', onDismiss() {} }))
  )
  assert.match(html, /aria-label="Close"/)
  assert.match(render({ status: 'error', onDismiss() {}, dismissLabel: 'Dismiss' }), /aria-label="Dismiss"/)
})

test('pointer and focus events from inside the toast stack are told apart from the rest of the page', () => {
  globalThis.Element ??= class {}
  const at = inStack => Object.assign(new Element(), { closest: selector => (inStack && selector === '[data-sonner-toaster]' ? {} : null) })
  assert.equal(fromToast({ target: at(true) }), true)
  assert.equal(fromToast({ target: at(false) }), false)
  assert.equal(fromToast({ target: null }), false)
})
