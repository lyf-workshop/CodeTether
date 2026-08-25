import {
  AgentBadge,
  Badge,
  Button,
  CodeBlock,
  ConversationItem,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DiffCard,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  Input,
  MachineBadge,
  PermissionCard,
  QuestionCard,
  ScrollArea,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  ShellRunCard,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TerminalCard,
  Textarea,
  ToolCallCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  agentDefinitions,
  executionStatuses,
  type AgentId,
  type DiffLine,
} from '@codetether/ui'

import { ShowcaseGroup, ShowcaseSection } from './showcase-section'

const foundationColors = [
  { label: 'Background', token: '--background', className: 'bg-background' },
  { label: 'Surface', token: '--surface', className: 'bg-surface' },
  {
    label: 'Surface muted',
    token: '--surface-muted',
    className: 'bg-surface-muted',
  },
  {
    label: 'Surface elevated',
    token: '--surface-elevated',
    className: 'bg-surface-elevated',
  },
  { label: 'Border', token: '--border', className: 'bg-border' },
  {
    label: 'Border strong',
    token: '--border-strong',
    className: 'bg-border-strong',
  },
  {
    label: 'Text primary',
    token: '--text-primary',
    className: 'bg-text-primary',
  },
  {
    label: 'Text secondary',
    token: '--text-secondary',
    className: 'bg-text-secondary',
  },
  {
    label: 'Text muted',
    token: '--text-muted',
    className: 'bg-text-muted',
  },
  { label: 'Primary', token: '--primary', className: 'bg-primary' },
  { label: 'Success', token: '--success', className: 'bg-success' },
  { label: 'Warning', token: '--warning', className: 'bg-warning' },
  { label: 'Danger', token: '--danger', className: 'bg-danger' },
  { label: 'Info', token: '--info', className: 'bg-info' },
] as const

const spacingTokens = [
  { label: '4', className: 'w-1' },
  { label: '8', className: 'w-2' },
  { label: '12', className: 'w-3' },
  { label: '16', className: 'w-4' },
  { label: '20', className: 'w-5' },
  { label: '24', className: 'w-6' },
  { label: '32', className: 'w-8' },
  { label: '40', className: 'w-10' },
  { label: '48', className: 'w-12' },
] as const

const showcaseAgents = [
  'codex',
  'claude',
  'opencode',
] as const satisfies readonly AgentId[]

const showcaseDiff = [
  {
    kind: 'context',
    content: 'export function getStatusLabel(status: ExecutionStatus) {',
    oldLineNumber: 18,
    newLineNumber: 18,
  },
  {
    kind: 'deletion',
    content: '  return statusLabels[status]',
    oldLineNumber: 19,
  },
  {
    kind: 'addition',
    content: '  return statusDefinitions[status].label',
    newLineNumber: 19,
  },
  {
    kind: 'context',
    content: '}',
    oldLineNumber: 20,
    newLineNumber: 20,
  },
] as const satisfies readonly DiffLine[]

export function ComponentShowcase() {
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background px-4 py-8 text-text-primary sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">
          <header className="pb-2">
            <p className="text-xs font-medium tracking-wide text-primary uppercase">
              Phase 1A · Development only
            </p>
            <h1 className="mt-2 text-display font-semibold">
              CodeTether Design System
            </h1>
            <p className="mt-2 max-w-3xl text-base text-text-secondary">
              A visual review surface for Figma 00 Foundations and 92
              Components. This route is not part of the product experience.
            </p>
          </header>

          <ShowcaseSection
            id="foundations"
            title="Foundations"
            description="Dark-theme semantic tokens mapped from Figma. Components consume token names rather than one-off visual values."
          >
            <div className="grid gap-8 xl:grid-cols-3">
              <ShowcaseGroup title="Typography">
                <div className="space-y-4">
                  <p className="text-display font-semibold">Display / 32</p>
                  <p className="text-page font-semibold">Page title / 28</p>
                  <p className="text-section font-semibold">Section / 18</p>
                  <p className="text-base">Body / 14 / Regular</p>
                  <p className="text-xs font-medium text-text-secondary">
                    Caption / 11 / Medium
                  </p>
                  <code className="block font-mono text-sm text-info">
                    Mono / code and terminal output
                  </code>
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Colors">
                <div className="grid gap-2 sm:grid-cols-2">
                  {foundationColors.map((color) => (
                    <div
                      key={color.token}
                      className="flex min-w-0 items-center gap-3 rounded-sm border border-border bg-surface-muted p-2"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          'size-6 shrink-0 rounded-xs border border-border ' +
                          color.className
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-text-primary">
                          {color.label}
                        </span>
                        <code className="block truncate text-2xs text-text-muted">
                          {color.token}
                        </code>
                      </span>
                    </div>
                  ))}
                </div>
              </ShowcaseGroup>

              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-1">
                <ShowcaseGroup title="Spacing">
                  <div className="space-y-2">
                    {spacingTokens.map((space) => (
                      <div
                        key={space.label}
                        className="flex items-center gap-3 text-xs text-text-secondary"
                      >
                        <span className="w-6 tabular-nums">{space.label}</span>
                        <span
                          aria-hidden="true"
                          className={
                            'h-1 rounded-full bg-primary ' + space.className
                          }
                        />
                      </div>
                    ))}
                  </div>
                </ShowcaseGroup>

                <ShowcaseGroup title="Radius & elevation">
                  <div className="flex flex-wrap items-end gap-3">
                    <span className="grid size-12 place-items-center rounded-xs border border-border-strong bg-surface-elevated text-2xs">
                      Small
                    </span>
                    <span className="grid size-12 place-items-center rounded-sm border border-border-strong bg-surface-elevated text-2xs">
                      Medium
                    </span>
                    <span className="grid size-12 place-items-center rounded-lg border border-border-strong bg-surface-elevated text-2xs">
                      Large
                    </span>
                    <span className="grid size-12 place-items-center rounded-full border border-border-strong bg-surface-elevated text-2xs">
                      Full
                    </span>
                  </div>
                </ShowcaseGroup>
              </div>
            </div>
          </ShowcaseSection>

          <ShowcaseSection
            id="primitives"
            title="Primitive components"
            description="Shared controls use clear hover, active, focus-visible, and disabled states. Radix powers compound interactions."
          >
            <div className="grid gap-8 xl:grid-cols-2">
              <ShowcaseGroup title="Buttons">
                <div className="flex flex-wrap items-center gap-3">
                  <Button>Default</Button>
                  <Button className="bg-primary-hover">Hover reference</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button disabled>Disabled</Button>
                  <Button variant="danger">Danger</Button>
                  <IconButton
                    label="More component actions"
                    variant="secondary"
                  >
                    <span aria-hidden="true">•••</span>
                  </IconButton>
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Badges">
                <div className="flex flex-wrap gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="outline">Outline</Badge>
                  <Badge variant="success">Success</Badge>
                  <Badge variant="warning">Warning</Badge>
                  <Badge variant="danger">Danger</Badge>
                  <Badge variant="info">Info</Badge>
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Inputs">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs text-text-secondary">
                    Project name
                    <Input placeholder="CodeTether V2" />
                  </label>
                  <label className="grid gap-1.5 text-xs text-text-secondary">
                    Search
                    <SearchInput placeholder="Search conversations" />
                  </label>
                  <label className="grid gap-1.5 text-xs text-text-secondary sm:col-span-2">
                    Message
                    <Textarea placeholder="Reply to the agent…" />
                  </label>
                  <label className="grid gap-1.5 text-xs text-text-secondary">
                    Disabled
                    <Input disabled value="Unavailable" readOnly />
                  </label>
                  <label className="grid gap-1.5 text-xs text-text-secondary">
                    Agent
                    <Select defaultValue="codex">
                      <SelectTrigger>
                        <SelectValue placeholder="Select an agent" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="codex">Codex</SelectItem>
                        <SelectItem value="claude">Claude Code</SelectItem>
                        <SelectItem value="opencode">OpenCode</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Tabs">
                <Tabs defaultValue="activity">
                  <TabsList>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                    <TabsTrigger value="changes">Changes</TabsTrigger>
                    <TabsTrigger value="terminal">Terminal</TabsTrigger>
                  </TabsList>
                  <TabsContent
                    value="activity"
                    className="rounded-sm border border-border bg-surface-inset p-3 text-sm text-text-secondary"
                  >
                    Activity uses a compact segmented treatment.
                  </TabsContent>
                  <TabsContent
                    value="changes"
                    className="rounded-sm border border-border bg-surface-inset p-3 text-sm text-text-secondary"
                  >
                    Changes keep their own panel content.
                  </TabsContent>
                  <TabsContent
                    value="terminal"
                    className="rounded-sm border border-border bg-surface-inset p-3 text-sm text-text-secondary"
                  >
                    Terminal remains a distinct information surface.
                  </TabsContent>
                </Tabs>
              </ShowcaseGroup>

              <ShowcaseGroup title="Menus, tooltip, dialog">
                <div className="flex flex-wrap gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary">Open menu</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>Conversation</DropdownMenuLabel>
                      <DropdownMenuItem>
                        Resume
                        <DropdownMenuShortcut>R</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem>Mark unread</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="danger">
                        Terminate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">Keyboard hint</Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Open command palette · Ctrl K
                    </TooltipContent>
                  </Tooltip>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button>Open dialog</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Interrupt this run?</DialogTitle>
                        <DialogDescription>
                          The current command will stop. Conversation history is
                          preserved.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="secondary">Keep running</Button>
                        <Button variant="danger">Interrupt</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Separator & scroll area">
                <ScrollArea className="h-40 rounded-sm border border-border bg-surface-inset">
                  <div className="p-3">
                    {executionStatuses.map((status, index) => (
                      <div key={status}>
                        <div className="flex items-center justify-between gap-3 py-2">
                          <span className="text-sm text-text-secondary">
                            Canonical status {index + 1}
                          </span>
                          <StatusBadge status={status} />
                        </div>
                        {index < executionStatuses.length - 1 ? (
                          <Separator />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </ShowcaseGroup>
            </div>
          </ShowcaseSection>

          <ShowcaseSection
            id="identity-status"
            title="Status & identity"
            description="Execution vocabulary and agent visuals are defined centrally. Product components do not branch on provider names."
          >
            <div className="grid gap-8 xl:grid-cols-2">
              <ShowcaseGroup title="Canonical execution status">
                <div className="flex flex-wrap gap-2">
                  {executionStatuses.map((status) => (
                    <StatusBadge key={status} status={status} />
                  ))}
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Agent & machine identity">
                <div className="flex flex-wrap items-center gap-3">
                  {showcaseAgents.map((agent) => (
                    <AgentBadge key={agent} agent={agent} />
                  ))}
                  <MachineBadge name="Development Mac" />
                  <MachineBadge name="Remote workstation" />
                </div>
                <p className="mt-3 text-xs text-text-muted">
                  {showcaseAgents
                    .map((agent) => agentDefinitions[agent].name)
                    .join(' · ')}
                </p>
              </ShowcaseGroup>
            </div>
          </ShowcaseSection>

          <ShowcaseSection
            id="activity"
            title="Conversation & activity"
            description="Presentational components accept mock props only. They do not own host state, persistence, or agent behavior."
          >
            <div className="grid gap-6 xl:grid-cols-2">
              <ShowcaseGroup title="Conversation items">
                <div className="space-y-3">
                  <ConversationItem
                    title="Polish the shared component library"
                    description="CodeTether V2 · Codex · 2 minutes ago"
                    status="running"
                  />
                  <ConversationItem
                    title="Approve package installation"
                    description="Design system · Claude Code · 8 minutes ago"
                    status="waiting"
                  />
                  <ConversationItem
                    title="Fix typecheck regressions"
                    description="Web workspace · OpenCode · Yesterday"
                    status="failed"
                  />
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Tool calls">
                <div className="space-y-3">
                  <ToolCallCard
                    title="packages/ui/src/components/button.tsx"
                    description="Read file"
                    status="completed"
                    metadata="4.2 KB"
                  />
                  <ToolCallCard
                    title="packages/ui/src/styles/globals.css"
                    description="Update file"
                    status="running"
                    delta={{ additions: 28, deletions: 6 }}
                  />
                  <ToolCallCard
                    title="Inspect component exports"
                    status="thinking"
                    action={<span>View details</span>}
                  />
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Shell runs">
                <div className="space-y-3">
                  <ShellRunCard
                    command="pnpm typecheck"
                    status="running"
                    summary="Running"
                  />
                  <ShellRunCard
                    command="pnpm lint"
                    status="completed"
                    summary="0 issues · 1.8s"
                  />
                  <ShellRunCard
                    command="pnpm test"
                    status="failed"
                    summary="Exit 1"
                  />
                </div>
              </ShowcaseGroup>

              <ShowcaseGroup title="Terminal">
                <TerminalCard
                  title="Quality checks"
                  output={[
                    '$ pnpm typecheck',
                    'All workspaces passed',
                    '',
                    '$ pnpm lint',
                    'No warnings or errors',
                    '',
                    '$ pnpm build',
                    'Building production bundle…',
                  ]}
                  action={<span>Open terminal</span>}
                />
              </ShowcaseGroup>
            </div>
          </ShowcaseSection>

          <ShowcaseSection
            id="code-changes"
            title="Code & changes"
            description="Code, diff, and terminal surfaces preserve horizontal navigation and do not rely on color alone for meaning."
          >
            <div className="grid gap-6 xl:grid-cols-2">
              <ShowcaseGroup title="Code block">
                <CodeBlock
                  language="tsx"
                  code={[
                    'export function StatusBadge({ status }: Props) {',
                    '  const definition = statusDefinitions[status]',
                    '',
                    '  return <Badge>{definition.label}</Badge>',
                    '}',
                  ].join('\n')}
                />
              </ShowcaseGroup>
              <ShowcaseGroup title="Diff card">
                <DiffCard
                  fileName="packages/ui/src/tokens/statuses.ts"
                  lines={showcaseDiff}
                />
              </ShowcaseGroup>
            </div>
          </ShowcaseSection>

          <ShowcaseSection
            id="decisions"
            title="Permissions & questions"
            description="Risk and response cards remain display-only compositions. Actions are supplied by the consuming mock surface."
          >
            <div className="grid gap-6 xl:grid-cols-3">
              <PermissionCard
                agent="codex"
                title="Read project metadata"
                description="Inspect package manifests in the workspace."
                command="rg --files -g package.json"
                risk="low"
                secondaryAction={
                  <Button size="sm" variant="secondary">
                    Reject
                  </Button>
                }
                primaryAction={<Button size="sm">Allow once</Button>}
              />
              <PermissionCard
                agent="claude"
                title="Install UI dependencies"
                description="Run a package manager command in this project."
                command="pnpm add radix-ui"
                risk="medium"
                secondaryAction={
                  <Button size="sm" variant="secondary">
                    Reject
                  </Button>
                }
                primaryAction={<Button size="sm">Allow once</Button>}
              />
              <PermissionCard
                agent="opencode"
                title="Remove generated output"
                description="Delete files from a selected output directory."
                command="Remove-Item output -Recurse"
                risk="high"
                secondaryAction={
                  <Button size="sm" variant="secondary">
                    Reject
                  </Button>
                }
                primaryAction={
                  <Button size="sm" variant="danger">
                    Allow once
                  </Button>
                }
              />
            </div>

            <Separator className="my-6" />

            <div className="space-y-3">
              <QuestionCard
                agent="codex"
                title="Which visual density should this panel use?"
                question="The Figma frame shows the compact variant at the desktop target."
                project="CodeTether V2"
                machine="Development Mac"
                timestamp="Just now"
                status="waiting"
                secondaryAction={
                  <Button size="sm" variant="secondary">
                    Reply later
                  </Button>
                }
                primaryAction={<Button size="sm">Reply</Button>}
              />
              <QuestionCard
                agent="claude"
                title="Component naming confirmed"
                question="Use the shared StatusBadge vocabulary across every provider."
                project="Design system"
                machine="Remote workstation"
                timestamp="4 minutes ago"
                status="completed"
              />
            </div>
          </ShowcaseSection>
        </div>
      </main>
    </TooltipProvider>
  )
}
