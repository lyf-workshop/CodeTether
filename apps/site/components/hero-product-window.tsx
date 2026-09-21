type ActivityState = 'done' | 'active' | 'next'

const projects = ['CodeTether', 'TF-LLM', 'SkillsBench', 'SaltLake KG']
const conversations = [
  ['Implement account control plane', 'Claude  ·  just now'],
  ['Website redesign', 'Codex  ·  just now'],
  ['Relay reconnect issue', 'Codex  ·  just now'],
]

function ActivityRow({
  state,
  children,
}: {
  state: ActivityState
  children: React.ReactNode
}) {
  return (
    <div className={`activity-row activity-${state}`}>
      <span className="activity-marker" aria-hidden="true">
        {state === 'done' ? '✓' : state === 'active' ? '>' : '...'}
      </span>
      <span>{children}</span>
    </div>
  )
}

export function HeroProductWindow() {
  return (
    <div className="product-window" aria-label="CodeTether workspace preview">
      <div className="window-titlebar">
        <div className="window-controls" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="window-title">CodeTether · TF-LLM</span>
        <span className="window-presence">
          <i /> 3 machines online
        </span>
      </div>

      <aside className="workspace-sidebar">
        <div className="sidebar-heading">PROJECTS</div>
        {projects.map((project, index) => (
          <div
            key={project}
            className={`project-row ${index === 0 ? 'selected' : ''}`}
          >
            <span className="project-dot" />
            <span>{project}</span>
          </div>
        ))}
        <div className="sidebar-rule" />
        <div className="sidebar-heading">CONVERSATIONS</div>
        {conversations.map(([title, meta], index) => (
          <div
            key={title}
            className={`conversation-row ${index === 0 ? 'selected-conversation' : ''}`}
          >
            <strong>{title}</strong>
            <span>{meta}</span>
          </div>
        ))}
      </aside>

      <main className="workspace-main">
        <div className="conversation-header">
          <strong>Website redesign</strong>
          <span className="provider-label">Codex · Windows Host</span>
        </div>
        <div className="user-prompt">
          Make the public website show the complete CodeTether product - not
          just cross-device access.
        </div>
        <div className="activity-card">
          <div className="activity-card-heading">
            <strong>Agent activity</strong>
            <span className="live-label">
              <i /> LIVE
            </span>
          </div>
          <ActivityRow state="done">Read product architecture</ActivityRow>
          <ActivityRow state="done">Inspect Figma source of truth</ActivityRow>
          <ActivityRow state="active">Editing homepage.tsx</ActivityRow>
          <ActivityRow state="next">Building motion sequence</ActivityRow>
        </div>
        <div className="diff-card">
          <span>+ apps/site/app/page.tsx</span>
          <span>+ HeroMotion</span>
          <span>+ Runtime Story</span>
        </div>
        <div className="assistant-message">
          The workspace is ready to show the full product story across machines,
          providers, and devices.
        </div>
      </main>

      <aside className="runtime-panel">
        <div className="runtime-heading">RUNTIME</div>
        <div className="runtime-machine runtime-active">
          <div className="runtime-name">
            <span className="status-dot green" /> Windows Desktop
          </div>
          <span className="runtime-state">LIVE</span>
          <small>Codex 0.47.1</small>
        </div>
        <div className="runtime-machine runtime-attention">
          <div className="runtime-name">
            <span className="status-dot orange" /> Mac mini
          </div>
          <span className="runtime-state">WAIT</span>
          <small>Claude Code 2.1.x</small>
        </div>
        <div className="runtime-machine">
          <div className="runtime-name">
            <span className="status-dot muted" /> Pi Node
          </div>
          <span className="runtime-state">IDLE</span>
          <small>Linux ARM64</small>
        </div>
        <div className="runtime-note">
          <span className="status-dot cyan" /> Relay connected
        </div>
      </aside>
    </div>
  )
}
