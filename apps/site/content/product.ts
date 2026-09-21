export const productPillars = [
  {
    eyebrow: 'WORKSPACE',
    title: 'Everything around the agent, not another agent.',
    body: 'Projects, conversations, search, attention, changes, and background work share one calm place to supervise what is happening.',
  },
  {
    eyebrow: 'RUNTIME',
    title: 'Machine is where. Provider is who.',
    body: 'Keep durable machine identity, provider selection, installation readiness, and execution health separate and understandable.',
  },
  {
    eyebrow: 'CONTINUITY',
    title: 'Discover. Adopt. Resume.',
    body: 'Find provider-native sessions and continue them through the provider mechanism. CodeTether organizes the reference; it does not replay history.',
  },
]

export const productFeatures = [
  'Projects and durable Conversations',
  'Search, Pin, Archive, and Inbox attention',
  'Agent activity, files, tools, shell output, and diffs',
  'Background sessions and notifications',
  'Machines, Providers, and explicit installations',
  'Native session discovery and resume',
  'Remote Nodes with Relay-assisted transport',
  'Mobile supervision without moving execution',
]

export const securityRoles = [
  {
    label: 'CLOUD',
    title: 'Identity + ownership',
    body: 'Accounts, Spaces, ProductDevices, Host claims, revocation, and bounded rendezvous.',
    tone: 'cyan',
  },
  {
    label: 'HOST',
    title: 'Workspace authority',
    body: 'Projects, Conversations, Turns, Provider selection, and durable product truth.',
    tone: 'violet',
  },
  {
    label: 'NODE',
    title: 'Provider runtime',
    body: 'Physical installations, native sessions, and exact execution where your code lives.',
    tone: 'green',
  },
  {
    label: 'RELAY',
    title: 'Transport only',
    body: 'Opaque rendezvous and transport. No Machine, workspace, or Provider authority.',
    tone: 'orange',
  },
] as const
