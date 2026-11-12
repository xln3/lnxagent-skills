import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { sessionLogExportDeps } from '@deepseek-ai/dsh-session-log-export'
import { exportHandoff } from './export.ts'

export const name = 'session-handoff'
export const inject = ['commands', 'sessionQuery', 'sessionPersistence', 'attachments']

export { exportHandoff } from './export.ts'
export {
  flattenLineage,
  renderHandoff,
  renderReview,
} from './projection.ts'
export type { ChildViewLink, SessionProjection } from './projection.ts'

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'handoff',
    description: 'Export this session as a complete review and continuation handoff',
    input: { hint: '[new output directory]' },
    handler: async (invocation): Promise<CommandResult> => {
      try {
        const services = sessionLogExportDeps(ctx)
        if (services.sessionQuery === undefined
          || services.sessionPersistence === undefined
          || services.attachments === undefined) {
          return {
            kind: 'error',
            text: '/handoff requires native sessionQuery, sessionPersistence, and attachments services.',
          }
        }
        const outputDirectory = resolveOutputDirectory(invocation)
        const result = await exportHandoff({
          sessionQuery: services.sessionQuery,
          sessionPersistence: services.sessionPersistence,
          attachments: services.attachments,
          sessions: services.sessions,
        }, invocation.agent.session.id, outputDirectory, invocation.signal)
        return {
          kind: 'success',
          text: `Handoff exported to ${result.outputDirectory}\nSessions: ${result.sessionCount}. Files: ${result.fileCount}.`,
        }
      } catch (error) {
        return {
          kind: 'error',
          text: `/handoff failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  })
}

function resolveOutputDirectory(invocation: CommandInvocation): string {
  const input = invocation.rawInput.trim()
  const cwd = invocation.agent.session.header.cwd
  if (input !== '') {
    if (path.isAbsolute(input)) return path.normalize(input)
    if (cwd === undefined) {
      throw new Error('A relative output directory requires a session working directory; use an absolute path.')
    }
    return path.resolve(cwd, input)
  }
  if (cwd === undefined) {
    throw new Error('This session has no working directory; supply an absolute output directory.')
  }
  const sessionSegment = invocation.agent.session.id.replace(/[^A-Za-z0-9_-]/gu, '_')
  return path.join(cwd, '.dsh-handoff', sessionSegment)
}
