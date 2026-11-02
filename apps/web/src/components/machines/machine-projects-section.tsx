import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import {
  AddProjectCard,
  Badge,
  Notice,
  ProjectCard,
  StatusTag,
} from '@codetether/ui'
import type { MachineSummary, ProjectRecord } from '@codetether/protocol'

import { allProjectConversationsQueryOptions } from '../../runtime/host/conversation-list-query'
import {
  useHostConnectionState,
  useHostRuntime,
} from '../../runtime/host/host-runtime-hooks'
import { projectLocationForMachine } from '../../runtime/host/project-location'
import { formatConversationActivity } from '../conversations/conversation-list-model'
import { AddProjectDialog } from '../projects/add-project-dialog'
import { ProjectLocationRemovalAction } from '../projects/project-location-removal-action'
import {
  deviceProjectState,
  machineCanAddProject,
  machineCannotAddProjectReason,
  projectConversationMetrics,
} from './device-project-model'

interface MachineProjectsSectionProps {
  machine: MachineSummary
  projects: readonly ProjectRecord[]
  heading?: boolean
  appearance?: 'cards' | 'list'
  showAddCard?: boolean
  showLocationRemoval?: boolean
  onLocationRemoved?: () => void
}

export function MachineProjectsSection({
  machine,
  projects,
  heading = true,
  appearance = 'cards',
  showAddCard = true,
  showLocationRemoval = false,
  onLocationRemoved,
}: MachineProjectsSectionProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const connectionState = useHostConnectionState()
  const canAdd =
    connectionState === 'connected' && machineCanAddProject(machine)
  const ownProjects = projects.filter(
    (project) =>
      projectLocationForMachine(project, machine.machineId) !== undefined,
  )
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${machine.displayName}上的项目`}
    >
      {heading ? (
        <h2 className="mb-3 text-lg font-semibold">
          项目{' '}
          <span className="ml-2 text-md font-normal text-text-muted">
            {ownProjects.length}
          </span>
        </h2>
      ) : null}
      <div
        className={
          appearance === 'cards'
            ? 'grid min-w-0 gap-4 sm:grid-cols-2 desktop:grid-cols-3'
            : 'min-w-0 space-y-2'
        }
      >
        {ownProjects.map((project) => (
          <div
            key={`${machine.machineId}:${project.projectId}`}
            className="min-w-0 space-y-2"
          >
            <MachineProjectCard
              machine={machine}
              project={project}
              appearance={appearance}
            />
            {showLocationRemoval && machine.kind === 'remote' ? (
              <ProjectLocationRemovalAction
                machine={machine}
                project={project}
                onRemoved={onLocationRemoved}
                returnFocus={() => sectionRef.current}
              />
            ) : null}
          </div>
        ))}
        {canAdd && showAddCard ? (
          <AddProjectDialog
            fixedMachineId={machine.machineId}
            trigger={
              <AddProjectCard
                description={`选择“${machine.displayName}”上的一个文件夹`}
              />
            }
          />
        ) : null}
      </div>
      {ownProjects.length === 0 && (!canAdd || !showAddCard) ? (
        <Notice title="这台设备上还没有项目">
          {canAdd
            ? '选择这台设备上的一个文件夹，添加项目后就能查看以前的会话。'
            : machineCannotAddProjectReason()}
        </Notice>
      ) : null}
    </section>
  )
}

function MachineProjectCard({
  machine,
  project,
  appearance,
}: {
  machine: MachineSummary
  project: ProjectRecord
  appearance: 'cards' | 'list'
}) {
  const runtime = useHostRuntime()
  const connectionState = useHostConnectionState()
  const cardRef = useRef<HTMLDivElement>(null)
  const [hasBeenVisible, setHasBeenVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    const card = cardRef.current
    if (hasBeenVisible || card === null) return
    let observing = true
    const observer = new IntersectionObserver((entries) => {
      if (
        !observing ||
        !entries.some((entry) => entry.target === card && entry.isIntersecting)
      )
        return
      observing = false
      setHasBeenVisible(true)
      observer.disconnect()
    })
    observer.observe(card)
    return () => {
      observing = false
      observer.disconnect()
    }
  }, [hasBeenVisible])
  const conversationsQuery = useQuery({
    ...allProjectConversationsQueryOptions(runtime, project.projectId),
    enabled: connectionState === 'connected' && hasBeenVisible,
  })
  const location = projectLocationForMachine(project, machine.machineId)
  const state = deviceProjectState(machine, location)
  const metrics = projectConversationMetrics(
    conversationsQuery.data,
    machine.machineId,
    project.locations.length > 1,
  )
  return (
    <div ref={cardRef}>
      <ProjectCard
        name={project.name}
        rootPath={location?.rootPath ?? '文件夹位置未知'}
        dimmed={!state.available}
        appearance={appearance === 'list' ? 'row' : 'card'}
        status={
          state.label ? (
            <Badge
              variant={state.label === '无法访问' ? 'danger' : 'secondary'}
              title={state.reason}
            >
              {state.label}
            </Badge>
          ) : metrics !== undefined && metrics.runningCount > 0 ? (
            <StatusTag tone="run">
              {metrics.capped ? '已加载 ' : ''}
              {metrics.runningCount} 个进行中
            </StatusTag>
          ) : undefined
        }
        metrics={metrics === undefined ? undefined : metrics.countLabel}
        activity={
          metrics?.lastActivityAt ? (
            <time dateTime={metrics.lastActivityAt}>
              {formatConversationActivity(metrics.lastActivityAt)}
            </time>
          ) : undefined
        }
        primaryAction={
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.projectId }}
            search={{ machineId: machine.machineId }}
            title={location?.rootPath}
            aria-label={`打开项目：${project.name} · ${machine.displayName}`}
            className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      />
    </div>
  )
}
