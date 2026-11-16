import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  SessionLineageNode,
  SessionLineageTrace,
  SessionLogSnapshot,
  SessionSurfaceSnapshot,
} from '@deepseek-ai/dsh-session-query'

export interface ChildViewLink {
  readonly sessionId: string
  readonly nativePath: string
  readonly reviewPath: string
  readonly handoffPath: string
}

export interface SessionProjection {
  readonly log: SessionLogSnapshot
  readonly surface: SessionSurfaceSnapshot
  readonly lineage: SessionLineageTrace
  readonly nativePath: string
  readonly children: readonly ChildViewLink[]
  /** Attachment id to package copies, as links relative to the view file. */
  readonly attachmentLinks: ReadonlyMap<string, readonly string[]>
}

export function flattenLineage(nodes: readonly SessionLineageNode[]): SessionLineageNode[] {
  return nodes.flatMap(node => [node, ...flattenLineage(node.descendants)])
}

export function renderReview(projection: SessionProjection): string {
  const { log, lineage, nativePath, children, attachmentLinks } = projection
  const sections = [
    '# DSH Session Review',
    metadata(log, lineage, nativePath),
    renderLineage(children, lineage),
    '## Coverage\n\n' + [
      `- Committed events: ${log.events.length}. Every event is retained below as complete native JSON.`,
      `- Current surface is captured separately through seq ${String(log.events.at(-1)?.seq ?? null)}.`,
      '- Unsettled streams, provider-hidden reasoning, workspace state, and external side effects are not inferred.',
    ].join('\n'),
    '## Event timeline',
    ...log.events.map(event => renderEvent(event, attachmentLinks)),
  ]
  return `${sections.join('\n\n').trimEnd()}\n`
}

export function renderHandoff(projection: SessionProjection): string {
  const { log, surface, lineage, nativePath, children, attachmentLinks } = projection
  const humanEvents = log.events.filter(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
  const sections = [
    '# DSH Session Handoff',
    metadata(log, lineage, nativePath),
    renderLineage(children, lineage),
    renderHumanRequirements(humanEvents, attachmentLinks),
    renderCurrentSurface(surface, attachmentLinks),
    renderToolState(log.events),
    '## Continuation boundaries\n\n' + [
      '- Use the complete human requirements and current surface above; do not treat this file as a native DSH resume.',
      '- Completed tool calls must not be replayed merely because they appear in history.',
      '- For unresolved or unknown-outcome calls, inspect external state before considering any retry.',
      '- Reasoning is present only when the provider committed it to the native log; hidden reasoning is unavailable.',
      '- Workspace files, uncommitted changes, processes, credentials, and external service state require separate verification.',
      '- Native JSONL is a logical DSH export. No byte-identity claim is made for a backend-specific physical source file.',
    ].join('\n'),
  ]
  return `${sections.join('\n\n').trimEnd()}\n`
}

function metadata(
  log: SessionLogSnapshot,
  lineage: SessionLineageTrace,
  nativePath: string,
): string {
  const header = log.session
  return '## Source\n\n' + [
    `- Session ID: \`${header.id}\``,
    `- DSH Session format: v${header.version}`,
    `- Created at: ${new Date(header.createdAt).toISOString()}`,
    `- Working directory: ${header.cwd === undefined ? '(not recorded)' : inlineCode(header.cwd)}`,
    `- Parent session: ${header.parentSession === undefined ? '(none)' : `\`${header.parentSession}\``}`,
    `- Origin: ${header.origin ?? '(root or unspecified)'}`,
    `- Delegation depth: ${header.delegationDepth ?? 0}`,
    `- Inherited events: ${log.inheritedEventCount}`,
    `- Lineage complete: ${lineage.complete ? 'yes' : `no; unresolved parent ${lineage.unresolvedParentId}`}`,
    `- Native logical log: [${nativePath}](${markdownDestination(nativePath)})`,
  ].join('\n')
}

function renderLineage(
  children: readonly ChildViewLink[],
  lineage: SessionLineageTrace,
): string {
  const lines = ['## Descendant sessions']
  if (children.length === 0) {
    lines.push('', 'No descendant sessions are visible in the native lineage.')
  } else {
    for (const child of children) {
      lines.push('', `### ${child.sessionId}`, '',
        `- [Native log](${markdownDestination(child.nativePath)})`,
        `- [Review](${markdownDestination(child.reviewPath)})`,
        `- [Handoff](${markdownDestination(child.handoffPath)})`)
    }
  }
  if (!lineage.complete) {
    lines.push('', `Lineage is incomplete: parent ${lineage.unresolvedParentId} is unavailable.`)
  }
  return lines.join('\n')
}

function renderHumanRequirements(
  events: readonly SessionEvent[],
  links: ReadonlyMap<string, readonly string[]>,
): string {
  const sections = [`## All human requirements (${events.length})`]
  if (events.length === 0) {
    sections.push('No direct human messages with source.kind=user are present.')
    return sections.join('\n\n')
  }
  for (const event of events) {
    if (event.type !== 'user/message') continue
    sections.push([
      `### Requirement at seq ${event.seq}`,
      `Recorded at ${new Date(event.time).toISOString()}. Surface operation: ${JSON.stringify(event.surfaceOp)}.`,
      renderContent(event.data.content, links),
      '<details><summary>Message metadata</summary>\n\n' + fenced(JSON.stringify({
        id: event.data.id,
        role: event.data.role,
        source: event.data.source,
      }, null, 2), 'json') + '\n\n</details>',
    ].join('\n\n'))
  }
  return sections.join('\n\n')
}

function renderCurrentSurface(
  surface: SessionSurfaceSnapshot,
  links: ReadonlyMap<string, readonly string[]>,
): string {
  const sections = [
    `## Current model surface (${surface.events.length} events)`,
    `Captured through seq ${String(surface.capturedThroughSeq)}. This is the native folded surface, not a reimplementation of compaction.`,
  ]
  if (surface.events.length === 0) sections.push('The current surface is empty.')
  for (const event of surface.events) sections.push(renderEvent(event, links))
  return sections.join('\n\n')
}

function renderToolState(events: readonly SessionEvent[]): string {
  const requests = new Map<string, { name: string; arguments: string; seq: number; started: boolean }>()
  const results = new Map<string, { isError: boolean; seq: number }>()
  for (const event of events) {
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type !== 'tool-call') continue
        const id = String(block.id)
        if (!requests.has(id)) {
          requests.set(id, {
            name: block.name,
            arguments: block.arguments,
            seq: event.seq,
            started: false,
          })
        }
      }
    } else if (event.type === 'tool/call') {
      requests.set(String(event.data.callId), {
        name: event.data.name,
        arguments: event.data.arguments,
        seq: event.seq,
        started: true,
      })
    } else if (event.type === 'tool/result') {
      results.set(String(event.data.message.toolCallId), {
        isError: event.data.message.isError === true,
        seq: event.seq,
      })
    }
  }
  const notStarted = [...requests].filter(([id, request]) => !request.started && !results.has(id))
  const unresolved = [...requests].filter(([id, request]) => request.started && !results.has(id))
  const failed = [...results].filter(([, result]) => result.isError)
  const lines = ['## Tool state', '',
    `- Model tool requests: ${requests.size}`,
    `- Recorded results: ${results.size}`,
    `- Requests without a recorded tool/call: ${notStarted.length}`,
    `- Started calls without a recorded result: ${unresolved.length}`,
    `- Error results: ${failed.length}`]
  if (notStarted.length > 0) {
    lines.push('', '### Tool requests not recorded as started', '',
      'These assistant requests have no tool/call in the committed prefix. No tool execution was recorded as started.')
    for (const [id, request] of notStarted) {
      lines.push('', `#### ${id} · ${request.name} · seq ${request.seq}`, '', fenced(prettyArguments(request.arguments), 'json'))
    }
  }
  if (unresolved.length > 0) {
    lines.push('', '### Unresolved or unknown-outcome calls', '',
      'These entries have a tool/call but no tool/result in the committed prefix. Their external outcome is unknown; do not retry blindly.')
    for (const [id, request] of unresolved) {
      lines.push('', `#### ${id} · ${request.name} · seq ${request.seq}`, '', fenced(prettyArguments(request.arguments), 'json'))
    }
  }
  if (failed.length > 0) {
    lines.push('', `Error result seqs: ${failed.map(([id, result]) => `${id}@${result.seq}`).join(', ')}`)
  }
  return lines.join('\n')
}

function renderEvent(event: SessionEvent, links: ReadonlyMap<string, readonly string[]>): string {
  return [
    `### seq ${event.seq} · ${event.type} · ${new Date(event.time).toISOString()}`,
    renderEventSummary(event, links),
    '<details><summary>Complete native event JSON</summary>\n\n'
      + fenced(JSON.stringify(event, null, 2), 'json')
      + '\n\n</details>',
  ].join('\n\n')
}

function renderEventSummary(event: SessionEvent, links: ReadonlyMap<string, readonly string[]>): string {
  switch (event.type) {
    case 'user/message':
      return `User-role source: ${event.data.source.kind}\n\n${renderContent(event.data.content, links)}`
    case 'system/message':
    case 'developer/message':
      return renderContent(event.data.message.content, links)
    case 'assistant/message':
      return [
        renderContent(event.data.message.content, links),
        `Stream records: ${event.data.stream.length}. Interrupted: ${event.data.interrupted === true ? 'yes' : 'no'}.`,
        event.data.usage === undefined ? 'Token usage: not recorded.' : fenced(JSON.stringify(event.data.usage, null, 2), 'json'),
      ].join('\n\n')
    case 'assistant/attempt':
      return `Failed, retried, cancelled, or otherwise non-surface attempt. Stream records: ${event.data.stream.length}.`
    case 'tool/call':
      return `Tool: ${event.data.name}\nCall ID: ${String(event.data.callId)}\n\n${fenced(prettyArguments(event.data.arguments), 'json')}`
    case 'tool/result':
      return [
        `Call ID: ${String(event.data.message.toolCallId)}. Error: ${event.data.message.isError === true ? 'yes' : 'no'}.`,
        renderContent(event.data.message.content, links),
        event.data.error === undefined ? '' : fenced(JSON.stringify(event.data.error, null, 2), 'json'),
      ].filter(part => part !== '').join('\n\n')
    case 'turn/end':
      return fenced(JSON.stringify(event.data.reason, null, 2), 'json')
    default:
      return 'No normalized summary is registered for this event type; the complete native JSON below remains authoritative.'
  }
}

function renderContent(content: unknown, links: ReadonlyMap<string, readonly string[]>): string {
  if (!Array.isArray(content)) return fenced(JSON.stringify(content, null, 2), 'json')
  if (content.length === 0) return '(empty content)'
  return content.map((block: unknown) => {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      return fenced(block.text, 'text')
    }
    return [fenced(JSON.stringify(block, null, 2), 'json'), renderAttachmentCopies(block, links)]
      .filter(part => part !== '').join('\n\n')
  }).join('\n\n')
}

function renderAttachmentCopies(block: unknown, links: ReadonlyMap<string, readonly string[]>): string {
  if (!isRecord(block) || (block.type !== 'file' && block.type !== 'image')) return ''
  const attachment = block.attachment
  if (!isRecord(attachment)) return ''
  const copies = links.get(String(attachment.attachmentId)) ?? []
  if (copies.length === 0) return 'Package copy: (not exported)'
  return copies.map(link => `Package copy: [${link}](${markdownDestination(link)})`).join('\n')
}

function prettyArguments(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function fenced(content: string, language: string): string {
  let longest = 0
  for (const match of content.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language}\n${content}\n${fence}`
}

function inlineCode(content: string): string {
  let longest = 0
  for (const match of content.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  const ticks = '`'.repeat(longest + 1)
  const padded = content.startsWith('`') || content.endsWith('`') ? ` ${content} ` : content
  return `${ticks}${padded.replaceAll('\n', ' ')}${ticks}`
}

function markdownDestination(path: string): string {
  return `<${path.replaceAll('>', '%3E')}>`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
