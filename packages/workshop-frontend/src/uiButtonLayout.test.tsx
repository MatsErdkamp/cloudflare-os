// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from '@matser/ui'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('UI Button rich-content layout', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
  })

  it('keeps rich children as direct flex items in the content row', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(
        <Button className="w-full justify-start gap-3">
          <span data-testid="icon">icon</span>
          <span data-testid="copy">copy</span>
        </Button>,
      )
    })

    const content = container.querySelector('[data-slot="button-content"]')
    expect(content).not.toBeNull()
    expect(Array.from(content!.children).map((child) => child.getAttribute('data-testid'))).toEqual([
      'icon',
      'copy',
    ])
  })
})
