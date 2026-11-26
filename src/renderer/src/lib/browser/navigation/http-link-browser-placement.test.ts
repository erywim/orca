import { describe, expect, it } from 'vitest'
import { resolveHttpLinkBrowserPlacement } from './http-link-browser-placement'

const loneSourceGroup = {
  layoutByWorktree: { wt: { type: 'leaf' as const, groupId: 'source' } },
  groupsByWorktree: { wt: [{ id: 'source', activeTabId: 'terminal' }] },
  unifiedTabsByWorktree: {
    wt: [{ id: 'terminal', groupId: 'source', contentType: 'terminal' as const, lastFocusedAt: 1 }]
  },
  activeGroupIdByWorktree: { wt: 'source' }
}

describe('resolveHttpLinkBrowserPlacement', () => {
  it('opens the link in the source group when the tab setting is on', () => {
    expect(
      resolveHttpLinkBrowserPlacement(
        { ...loneSourceGroup, settings: { openLinksInTab: true } },
        'wt'
      )
    ).toEqual({ targetGroupId: 'source' })
  })

  it('keeps the split layout while the tab setting is off', () => {
    expect(
      resolveHttpLinkBrowserPlacement(
        { ...loneSourceGroup, settings: { openLinksInTab: false } },
        'wt'
      )
    ).toEqual({ split: { sourceGroupId: 'source', splitDirection: 'right', activate: false } })
  })
})
