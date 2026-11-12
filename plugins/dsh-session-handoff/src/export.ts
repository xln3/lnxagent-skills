import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { interruptedTurnClosers, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionLineageNode,
  SessionLineageTrace,
  SessionLogSnapshot,
  SessionRecord,
  SessionSurfaceSnapshot,
} from '@deepseek-ai/dsh-session-query'
import {
  SESSION_LOG_FILENAME,
  flushLiveSessionLog,
  readSessionLogText,
  sessionLogZipEntries,
  type SessionLogExportReady,
  type SessionLogZipEntry,
} from '@deepseek-ai/dsh-session-log-export'
import {
  renderHandoff,
  renderReview,
  type ChildViewLink,
} from './projection.ts'

const ADAPTER_VERSION = '0.1.0'
const DSH_API_VERSION = '0.2.2-rc.1'

interface SessionWork {
  readonly record: SessionRecord
  readonly log: SessionLogSnapshot
  readonly surface: SessionSurfaceSnapshot
  readonly lineage: SessionLineageTrace
  readonly nativePath: string
  readonly reviewPath: string
  readonly handoffPath: string
  readonly children: readonly SessionWork[]
}

interface WrittenEntry {
  readonly path: string
  readonly kind: 'native-log' | 'artifact' | 'view'
  readonly bytes: number
  readonly sha256: string
}

export interface HandoffExportResult {
  readonly outputDirectory: string
  readonly sessionCount: number
  readonly fileCount: number
}

export async function exportHandoff(
  deps: SessionLogExportReady,
  sessionId: SessionId,
  outputDirectory: string,
  signal: AbortSignal,
): Promise<HandoffExportResult> {
  await flushLiveSessionLog(deps, sessionId, signal)
  const rootContent = await readSessionLogText(deps.sessionPersistence, sessionId, signal)
  if (rootContent === undefined) throw new Error(`Session ${sessionId} has no stored logical log`)
  const lineage = await deps.sessionQuery.traceSession(sessionId, signal)
  const root = await loadSessionWork(
    deps.sessionQuery,
    lineage.target,
    lineage,
    `native/${SESSION_LOG_FILENAME}`,
    'views',
    signal,
  )
  const sessions = flattenWork(root)
  const workByNativePath = new Map<string, SessionWork>()
  for (const work of sessions) {
    if (workByNativePath.has(work.nativePath)) {
      throw new Error(`Multiple sessions map to ${work.nativePath}`)
    }
    workByNativePath.set(work.nativePath, work)
  }
  const nativeEventCounts = new Map<string, number>()
  nativeEventCounts.set(root.nativePath, validateNativeLog(root, rootContent))

  const target = path.resolve(outputDirectory)
  await assertAbsent(target)
  const parent = path.dirname(target)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const staging = path.join(parent, `.${path.basename(target)}.tmp-${randomUUID()}`)
  const entries: WrittenEntry[] = []
  await mkdir(staging, { recursive: false, mode: 0o700 })
  try {
    for await (const entry of sessionLogZipEntries(deps, rootContent, sessionId, true, signal)) {
      signal.throwIfAborted()
      const outputPath = nativeEntryPath(entry.path)
      if ('content' in entry) {
        const work = workByNativePath.get(outputPath)
        if (work === undefined) throw new Error(`Export produced an unexpected session log: ${outputPath}`)
        nativeEventCounts.set(outputPath, validateNativeLog(work, entry.content))
      }
      entries.push(await writeNativeEntry(staging, entry, outputPath, signal))
    }
    for (const work of sessions) {
      if (!nativeEventCounts.has(work.nativePath)) {
        throw new Error(`Export omitted the native log for session ${work.record.header.id}`)
      }
    }
    entries.push(...await writeViews(staging, root, attachmentPaths(entries)))
    const manifest = {
      schema: 'dsh-session-handoff/v0.1',
      adapter: {
        name: '@lnxagent/dsh-session-handoff',
        version: ADAPTER_VERSION,
        dshApiVersion: DSH_API_VERSION,
      },
      source: {
        runtime: 'dsh',
        logicalFormatVersion: root.log.session.version,
        rootSessionId: String(sessionId),
        physicalSourceByteIdentity: 'not-claimed',
      },
      lineageComplete: root.lineage.complete,
      sessions: sessions.map(work => sessionManifest(
        work,
        requiredNativeEventCount(nativeEventCounts, work),
      )),
      coverage: {
        committedEvents: 'included',
        currentSurface: 'included-from-native-session-query',
        descendants: 'included-recursively-or-export-fails',
        attachments: 'declared-built-in-references-included-or-export-fails',
        unknownEventAttachmentReferences: 'not-discovered',
        reasoning: 'included-only-when-present-in-native-log',
        unsettledStreams: 'unavailable',
        workspaceAndExternalState: 'not-captured',
        concurrentSourceChanges: 'detected-and-export-fails',
      },
      entries,
    }
    await writeBytes(staging, 'manifest.json', new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`))
    await rename(staging, target)
    return {
      outputDirectory: target,
      sessionCount: sessions.length,
      fileCount: entries.length + 1,
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function loadSessionWork(
  query: SessionLogExportReady['sessionQuery'],
  record: SessionRecord,
  lineage: SessionLineageTrace,
  nativePath: string,
  viewDirectory: string,
  signal: AbortSignal,
): Promise<SessionWork> {
  signal.throwIfAborted()
  const [log, surface] = await Promise.all([
    query.readSession(record.header.id),
    query.readSurface(record.header.id),
  ])
  const lastSeq = log.events.at(-1)?.seq ?? null
  if (surface.capturedThroughSeq !== lastSeq || surface.session.id !== log.session.id) {
    throw new Error(`Session ${record.header.id} changed while it was being observed; retry the export`)
  }
  const children: SessionWork[] = []
  for (const child of lineage.descendants) {
    signal.throwIfAborted()
    children.push(await loadChildSessionWork(query, child, signal))
  }
  return {
    record,
    log,
    surface,
    lineage,
    nativePath,
    reviewPath: `${viewDirectory}/review.md`,
    handoffPath: `${viewDirectory}/handoff.md`,
    children,
  }
}

async function loadChildSessionWork(
  query: SessionLogExportReady['sessionQuery'],
  node: SessionLineageNode,
  signal: AbortSignal,
): Promise<SessionWork> {
  const id = node.session.header.id
  const segment = safeSessionIdSegment(id)
  const lineage = await query.traceSession(id, signal)
  return loadSessionWork(
    query,
    node.session,
    lineage,
    `native/subagents/${segment}/${SESSION_LOG_FILENAME}`,
    `views/subagents/${segment}`,
    signal,
  )
}

function validateNativeLog(work: SessionWork, content: string): number {
  let rows: unknown[]
  try {
    rows = content.trimEnd().split('\n').map(line => JSON.parse(line) as unknown)
  } catch (error) {
    throw new Error(`Native log for session ${work.record.header.id} is not valid JSONL`, { cause: error })
  }
  if (rows.length === 0) throw new Error(`Native log for session ${work.record.header.id} is empty`)
  const header = rows[0] as { type?: unknown; id?: unknown; version?: unknown }
  if (header.type !== 'session' || header.id !== work.log.session.id
    || header.version !== work.log.session.version) {
    throw new Error(`Native log header does not match session ${work.record.header.id}`)
  }
  const events = rows.slice(1) as SessionEvent[]
  if (events.length > work.log.events.length) {
    throw new Error(`Session ${work.record.header.id} gained events during export; retry the export`)
  }
  for (const [index, event] of events.entries()) {
    if (JSON.stringify(event) !== JSON.stringify(work.log.events[index])) {
      throw new Error(`Session ${work.record.header.id} has inconsistent native and view events at seq ${event.seq}; retry the export`)
    }
  }
  const recoveryEvents = work.log.events.slice(events.length)
  const expectedRecovery = interruptedTurnClosers(events)
  if (JSON.stringify(recoveryEvents) !== JSON.stringify(expectedRecovery)) {
    throw new Error(`Session ${work.record.header.id} has unaccounted trailing view events; retry the export`)
  }
  return events.length
}

function requiredNativeEventCount(
  counts: ReadonlyMap<string, number>,
  work: SessionWork,
): number {
  const count = counts.get(work.nativePath)
  if (count === undefined) throw new Error(`Missing native event count for ${work.record.header.id}`)
  return count
}

async function writeViews(
  staging: string,
  root: SessionWork,
  attachments: ReadonlyMap<string, readonly string[]>,
): Promise<WrittenEntry[]> {
  const entries: WrittenEntry[] = []
  for (const work of flattenWork(root)) {
    const children = work.children.map(child => childLink(work, child))
    const attachmentLinks = new Map([...attachments].map(([id, paths]) =>
      [id, paths.map(target => relativeLink(work.reviewPath, target))]))
    const projection = {
      log: work.log,
      surface: work.surface,
      lineage: work.lineage,
      nativePath: relativeLink(work.reviewPath, work.nativePath),
      children,
      attachmentLinks,
    }
    const review = renderReview(projection)
    const handoff = renderHandoff({
      ...projection,
      nativePath: relativeLink(work.handoffPath, work.nativePath),
    })
    entries.push(await writeTextEntry(staging, work.reviewPath, review, 'view'))
    entries.push(await writeTextEntry(staging, work.handoffPath, handoff, 'view'))
  }
  return entries
}

/**
 * Map attachment ids back to the artifact paths DSH chose for them:
 * `files/<prefix>/<digest>/<name>` for stored files and
 * `media/<attachmentId>.<ext>` for images.
 */
function attachmentPaths(entries: readonly WrittenEntry[]): Map<string, string[]> {
  const paths = new Map<string, string[]>()
  for (const entry of entries) {
    if (entry.kind !== 'artifact') continue
    const file = /^artifacts\/files\/[^/]+\/([^/]+)\/[^/]+$/u.exec(entry.path)
    const media = /^artifacts\/media\/(.+)\.[^./]+$/u.exec(entry.path)
    const id = file !== null ? `sha256:${file[1]}` : media?.[1]
    if (id === undefined) continue
    paths.set(id, [...paths.get(id) ?? [], entry.path])
  }
  return paths
}

function childLink(from: SessionWork, child: SessionWork): ChildViewLink {
  return {
    sessionId: String(child.record.header.id),
    nativePath: relativeLink(from.handoffPath, child.nativePath),
    reviewPath: relativeLink(from.handoffPath, child.reviewPath),
    handoffPath: relativeLink(from.handoffPath, child.handoffPath),
  }
}

function relativeLink(fromFile: string, target: string): string {
  return path.posix.relative(path.posix.dirname(fromFile), target)
}

function flattenWork(root: SessionWork): SessionWork[] {
  return [root, ...root.children.flatMap(flattenWork)]
}

function sessionManifest(work: SessionWork, nativeEventCount: number) {
  return {
    header: work.log.session,
    inheritedEventCount: work.log.inheritedEventCount,
    eventCount: nativeEventCount,
    observedEventCount: work.log.events.length,
    recoveryEventCount: work.log.events.length - nativeEventCount,
    currentSurfaceEventCount: work.surface.events.length,
    capturedThroughSeq: work.surface.capturedThroughSeq,
    humanRequirementCount: work.log.events.filter(event =>
      event.type === 'user/message' && event.data.source.kind === 'user').length,
    nativePath: work.nativePath,
    reviewPath: work.reviewPath,
    handoffPath: work.handoffPath,
  }
}

async function writeNativeEntry(
  staging: string,
  entry: SessionLogZipEntry,
  outputPath: string,
  signal: AbortSignal,
): Promise<WrittenEntry> {
  if ('content' in entry) {
    return writeBytes(staging, outputPath, new TextEncoder().encode(entry.content), 'native-log')
  }
  if ('data' in entry) {
    return writeBytes(staging, outputPath, entry.data, 'artifact')
  }
  const absolute = safeAbsolutePath(staging, outputPath)
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 })
  const hash = createHash('sha256')
  let bytes = 0
  const handle = await open(absolute, 'wx', 0o600)
  try {
    for await (const chunk of entry.chunks) {
      signal.throwIfAborted()
      hash.update(chunk)
      bytes += chunk.byteLength
      let offset = 0
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)
        if (bytesWritten === 0) throw new Error(`Failed to write ${outputPath}`)
        offset += bytesWritten
      }
    }
  } finally {
    await handle.close()
  }
  return {
    path: outputPath,
    kind: 'artifact',
    bytes,
    sha256: hash.digest('hex'),
  }
}

function nativeEntryPath(sourcePath: string): string {
  if (sourcePath.startsWith('media/') || sourcePath.startsWith('files/')) {
    return safePackagePath(`artifacts/${sourcePath}`)
  }
  return safePackagePath(`native/${sourcePath}`)
}

async function writeTextEntry(
  staging: string,
  outputPath: string,
  content: string,
  kind: WrittenEntry['kind'],
): Promise<WrittenEntry> {
  return writeBytes(staging, outputPath, new TextEncoder().encode(content), kind)
}

async function writeBytes(
  staging: string,
  outputPath: string,
  data: Uint8Array,
  kind: WrittenEntry['kind'] = 'view',
): Promise<WrittenEntry> {
  const absolute = safeAbsolutePath(staging, outputPath)
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 })
  const handle = await open(absolute, 'wx', 0o600)
  try {
    await handle.writeFile(data)
  } finally {
    await handle.close()
  }
  return {
    path: outputPath,
    kind,
    bytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  }
}

function safePackagePath(value: string): string {
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new Error(`Unsafe export path: ${value}`)
  }
  const normalized = path.posix.normalize(value)
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new Error(`Unsafe export path: ${value}`)
  }
  return normalized
}

function safeAbsolutePath(staging: string, outputPath: string): string {
  const safePath = safePackagePath(outputPath)
  const absolute = path.resolve(staging, safePath)
  if (absolute !== staging && !absolute.startsWith(`${staging}${path.sep}`)) {
    throw new Error(`Export path escapes destination: ${outputPath}`)
  }
  return absolute
}

function safeSessionIdSegment(id: SessionId): string {
  return id.replace(/[^A-Za-z0-9_-]/gu, '_')
}

async function assertAbsent(target: string): Promise<void> {
  try {
    await lstat(target)
    throw new Error(`Export destination already exists: ${target}`)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
