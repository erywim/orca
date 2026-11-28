/** Removing a workspace leaves its child workspaces on disk, unparented; only an explicit force may do that. */
export type ChildWorktreeRemovalDecision =
  | { kind: 'none' }
  | { kind: 'refuse'; message: string }
  | { kind: 'detach'; childWorktreeIds: readonly string[]; warning: string }

function childNoun(count: number): string {
  return count === 1 ? 'child workspace' : 'child workspaces'
}

export function decideChildWorktreeRemoval(
  childWorktreeIds: readonly string[] | undefined,
  force: boolean
): ChildWorktreeRemovalDecision {
  const children = childWorktreeIds ?? []
  if (children.length === 0) {
    return { kind: 'none' }
  }
  const noun = childNoun(children.length)
  const list = children.join(', ')
  if (!force) {
    return {
      kind: 'refuse',
      message: `This workspace has ${children.length} ${noun}: ${list}. Remove ${
        children.length === 1 ? 'it' : 'them'
      } first, or pass --force to remove this workspace and detach ${
        children.length === 1 ? 'it' : 'them'
      }.`
    }
  }
  return {
    kind: 'detach',
    childWorktreeIds: children,
    warning: `warning: ${children.length} ${noun} ${
      children.length === 1 ? 'was' : 'were'
    } detached: ${list}`
  }
}
