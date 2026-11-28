import { describe, expect, it } from 'vitest'
import { decideChildWorktreeRemoval } from './worktree-removal-children'

describe('decideChildWorktreeRemoval', () => {
  it('does nothing for a workspace without children', () => {
    expect(decideChildWorktreeRemoval(undefined, false)).toEqual({ kind: 'none' })
    expect(decideChildWorktreeRemoval([], true)).toEqual({ kind: 'none' })
  })

  it('refuses a parent with children unless forced, naming them', () => {
    expect(decideChildWorktreeRemoval(['child-1'], false)).toEqual({
      kind: 'refuse',
      message:
        'This workspace has 1 child workspace: child-1. Remove it first, or pass --force to remove this workspace and detach it.'
    })
  })

  it('lists every child in the refusal', () => {
    const decision = decideChildWorktreeRemoval(['child-1', 'child-2'], false)
    expect(decision).toMatchObject({ kind: 'refuse' })
    expect(decision.kind === 'refuse' ? decision.message : '').toContain(
      '2 child workspaces: child-1, child-2'
    )
  })

  it('detaches children with a force and reports what was detached', () => {
    expect(decideChildWorktreeRemoval(['child-1', 'child-2'], true)).toEqual({
      kind: 'detach',
      childWorktreeIds: ['child-1', 'child-2'],
      warning: 'warning: 2 child workspaces were detached: child-1, child-2'
    })
    expect(decideChildWorktreeRemoval(['child-1'], true)).toMatchObject({
      warning: 'warning: 1 child workspace was detached: child-1'
    })
  })
})
