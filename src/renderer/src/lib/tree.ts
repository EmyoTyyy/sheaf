import type { FileEvent, FileNode } from '@shared/types'
import { basename, dirname, kindOf } from './paths'

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export function findNode(root: FileNode | null, path: string): FileNode | null {
  if (!root) return null
  if (path === '') return root
  const segments = path.split('/')
  let current: FileNode = root
  for (const segment of segments) {
    const next = current.children?.find((child) => child.name === segment)
    if (!next) return null
    current = next
  }
  return current
}

/** Returns a new tree with the node inserted, creating parents when needed. */
function withInserted(root: FileNode, path: string, node: FileNode): FileNode {
  const parentPath = dirname(path)
  const insert = (current: FileNode, remaining: string[], prefix: string): FileNode => {
    if (remaining.length === 0) {
      const children = current.children ?? []
      const existing = children.findIndex((child) => child.name === node.name)
      const nextChildren =
        existing === -1
          ? [...children, node]
          : children.map((child, index) => (index === existing ? { ...child, ...node } : child))
      return { ...current, children: sortNodes(nextChildren) }
    }

    const [head, ...tail] = remaining
    const children = current.children ?? []
    const index = children.findIndex((child) => child.name === head)
    const childPath = prefix ? `${prefix}/${head}` : head

    if (index === -1) {
      // The parent directory has not been seen yet; create it.
      const created: FileNode = { name: head, path: childPath, type: 'directory', children: [] }
      return {
        ...current,
        children: sortNodes([...children, insert(created, tail, childPath)])
      }
    }

    const nextChildren = [...children]
    nextChildren[index] = insert(children[index], tail, childPath)
    return { ...current, children: nextChildren }
  }

  return insert(root, parentPath ? parentPath.split('/') : [], '')
}

function withRemoved(root: FileNode, path: string): FileNode {
  const segments = path.split('/')
  const remove = (current: FileNode, remaining: string[]): FileNode => {
    const children = current.children ?? []
    if (remaining.length === 1) {
      return { ...current, children: children.filter((child) => child.name !== remaining[0]) }
    }
    const [head, ...tail] = remaining
    const index = children.findIndex((child) => child.name === head)
    if (index === -1) return current
    const nextChildren = [...children]
    nextChildren[index] = remove(children[index], tail)
    return { ...current, children: nextChildren }
  }
  return remove(root, segments)
}

/**
 * Applies watcher events to the tree without rebuilding it, so a save in a
 * large project does not re-render the whole explorer.
 */
export function applyFileEvents(root: FileNode | null, events: FileEvent[]): FileNode | null {
  if (!root) return root
  let next = root

  for (const event of events) {
    if (!event.path) continue
    switch (event.type) {
      case 'add':
        next = withInserted(next, event.path, {
          name: basename(event.path),
          path: event.path,
          type: 'file',
          kind: event.kind ?? kindOf(event.path),
          size: event.size,
          mtimeMs: event.mtimeMs
        })
        break
      case 'addDir':
        if (findNode(next, event.path)) break
        next = withInserted(next, event.path, {
          name: basename(event.path),
          path: event.path,
          type: 'directory',
          children: []
        })
        break
      case 'change': {
        const existing = findNode(next, event.path)
        if (!existing) break
        next = withInserted(next, event.path, {
          ...existing,
          size: event.size ?? existing.size,
          mtimeMs: event.mtimeMs ?? existing.mtimeMs
        })
        break
      }
      case 'unlink':
      case 'unlinkDir':
        next = withRemoved(next, event.path)
        break
    }
  }

  return next
}

/** Every file in the tree, depth first, used by quick open and search. */
export function flattenFiles(root: FileNode | null): FileNode[] {
  if (!root) return []
  const files: FileNode[] = []
  const visit = (node: FileNode): void => {
    for (const child of node.children ?? []) {
      if (child.type === 'directory') visit(child)
      else files.push(child)
    }
  }
  visit(root)
  return files
}

export function collectDirectories(root: FileNode | null): FileNode[] {
  if (!root) return []
  const directories: FileNode[] = [root]
  const visit = (node: FileNode): void => {
    for (const child of node.children ?? []) {
      if (child.type !== 'directory') continue
      directories.push(child)
      visit(child)
    }
  }
  visit(root)
  return directories
}
