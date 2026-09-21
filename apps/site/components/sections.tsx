import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowUpRight,
  Bell,
  Check,
  FolderGit2,
  GitBranch,
  LockKeyhole,
  Search,
  Smartphone,
  Terminal,
  Wifi,
} from 'lucide-react'
import {
  productFeatures,
  productPillars,
  securityRoles,
} from '../content/product'

function SectionIntro({
  eyebrow,
  title,
  body,
  dark = false,
}: {
  eyebrow: string
  title: string
  body: string
  dark?: boolean
}) {
  return (
    <div className={`section-intro ${dark ? 'section-intro-dark' : ''}`}>
      <div>
        <span className="eyebrow eyebrow-cyan">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <p>{body}</p>
    </div>
  )
}

export function WorkspaceStory() {
  return (
    <section id="how-it-works" className="section section-workspace">
      <SectionIntro
        eyebrow="UNIFIED AGENT WORKSPACE"
        title="Everything around the agent, not another agent."
        body="CodeTether brings together the work you already do: projects, conversations, search, attention, tools, files, diffs, and the state of every running session."
      />
      <div className="workspace-story-grid">
        <div className="workspace-story-surface workspace-story-capture">
          <Image
            src="/product/codetether-workspace.png"
            alt="Real CodeTether desktop workspace capture"
            fill
            sizes="(max-width: 900px) 100vw, 62vw"
          />
          <div className="capture-caption">REAL DESKTOP WORKSPACE</div>
        </div>
        <div className="workspace-story-column">
          <div className="workspace-feature-card">
            <div className="feature-icon">
              <Search size={17} />
            </div>
            <div>
              <strong>Find the thread, not a transcript dump.</strong>
              <p>
                Search durable titles and the questions you asked, then jump to
                the exact turn.
              </p>
            </div>
          </div>
          <div className="workspace-feature-card">
            <div className="feature-icon feature-icon-violet">
              <GitBranch size={17} />
            </div>
            <div>
              <strong>See what changed.</strong>
              <p>
                Files, diffs, agent output, and tool activity stay in the same
                context.
              </p>
            </div>
          </div>
          <div className="workspace-feature-card">
            <div className="feature-icon feature-icon-green">
              <Terminal size={17} />
            </div>
            <div>
              <strong>Background work has a home.</strong>
              <p>
                Keep long-running sessions visible without keeping one
                foreground window open.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="workspace-pill-row">
        {[
          'Projects',
          'Conversations',
          'Inbox',
          'Search',
          'Pin / Archive',
          'Files + diffs',
          'Tool output',
          'Notifications',
        ].map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  )
}

export function RuntimeStory() {
  return (
    <section className="section section-runtime">
      <SectionIntro
        eyebrow="MACHINE + PROVIDER RUNTIME"
        title="Machine is where. Provider is who."
        body="A durable Machine identity is not a network address. A Provider is not a machine. CodeTether keeps the choices, installations, readiness, and execution health legible."
      />
      <div className="runtime-stage">
        <div className="machine-cards">
          <div className="machine-card machine-card-active">
            <div>
              <span className="status-dot green" /> Windows Desktop
            </div>
            <small>Host · Codex 0.47.1</small>
            <b>ONLINE</b>
          </div>
          <div className="machine-card">
            <div>
              <span className="status-dot cyan" /> Mac mini
            </div>
            <small>Node · macOS arm64</small>
            <b>ONLINE</b>
          </div>
          <div className="machine-card">
            <div>
              <span className="status-dot muted" /> Home Pi
            </div>
            <small>Node · Linux ARM64</small>
            <b>OFFLINE</b>
          </div>
        </div>
        <div className="runtime-connector" aria-hidden="true">
          <span /> <span /> <span />
        </div>
        <div className="provider-panel">
          <div className="panel-label">
            PROVIDER INSTALLATIONS <span>3</span>
          </div>
          <div className="provider-row">
            <div>
              <strong>Codex</strong>
              <small>0.47.1 · selected</small>
            </div>
            <span className="ready-tag">READY</span>
          </div>
          <div className="provider-row">
            <div>
              <strong>Codex</strong>
              <small>0.46.0 · compatible</small>
            </div>
            <span className="quiet-tag">AVAILABLE</span>
          </div>
          <div className="provider-row">
            <div>
              <strong>Claude Code</strong>
              <small>2.1.x · authenticated</small>
            </div>
            <span className="ready-tag">READY</span>
          </div>
          <div className="provider-note">
            <LockKeyhole size={13} /> Selection is explicit. Existing
            Conversations never silently fall back.
          </div>
        </div>
      </div>
      <div className="runtime-principles">
        {[
          'selection',
          'compatibility',
          'readiness',
          'backend health',
          'execution health',
        ].map((item, index) => (
          <span key={item} className={index === 0 ? 'principle-active' : ''}>
            {item}
          </span>
        ))}
      </div>
    </section>
  )
}

export function ContinuityStory() {
  return (
    <section className="section section-continuity">
      <SectionIntro
        eyebrow="NATIVE SESSION CONTINUITY"
        title="Your history stays where it belongs."
        body="Provider-native sessions remain Provider-owned. CodeTether discovers a reference, adopts it into workspace organization, then resumes through the native mechanism when you ask."
      />
      <div className="continuity-flow">
        {[
          [
            '01',
            'Discover',
            'Find provider-native historical sessions in an authorized project location.',
            'search',
          ],
          [
            '02',
            'Adopt',
            'Bring a reference into CodeTether organization without copying messages.',
            'folder',
          ],
          [
            '03',
            'Resume',
            'Continue through the Provider-native session mechanism.',
            'play',
          ],
        ].map(([number, title, body, icon]) => (
          <div key={title} className="continuity-step">
            <span className="step-number">{number}</span>
            <div className="continuity-icon">
              {icon === 'search' ? (
                <Search size={18} />
              ) : icon === 'folder' ? (
                <FolderGit2 size={18} />
              ) : (
                <ArrowUpRight size={18} />
              )}
            </div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
      <div className="continuity-note">
        <span>Provider-native history</span>
        <ArrowUpRight size={15} />
        <span>CodeTether reference</span>
        <ArrowUpRight size={15} />
        <span>Explicit native resume</span>
      </div>
    </section>
  )
}

export function MobileSupervisorStory() {
  return (
    <section className="section section-mobile-supervisor">
      <SectionIntro
        eyebrow="MOBILE SUPERVISOR"
        title="Leave the desk. Keep the context."
        body="Open Projects, see the current Machine and Provider, receive attention, and respond where the product permits. Execution stays on the original machine."
      />
      <div className="mobile-story-grid">
        <div className="phone-frame" aria-label="Mobile Supervisor preview">
          <div className="phone-speaker" />
          <div className="phone-screen">
            <div className="phone-status">
              <span>9:41</span>
              <span>LTE 100%</span>
            </div>
            <div className="phone-header">
              <span>CodeTether</span>
              <Bell size={15} />
            </div>
            <div className="phone-project">
              <small>PROJECT</small>
              <strong>CodeTether</strong>
              <span>Mac mini · Claude Code</span>
            </div>
            <div className="phone-attention">
              <div>
                <span className="status-dot orange" /> Approval needed
              </div>
              <small>Review access to account settings</small>
              <button type="button">Open conversation</button>
            </div>
            <div className="phone-progress">
              <span>Website redesign</span>
              <b>82%</b>
              <div>
                <i />
              </div>
            </div>
          </div>
        </div>
        <div className="mobile-story-copy">
          <div className="mobile-point">
            <Smartphone size={17} />
            <div>
              <strong>Supervision, not execution.</strong>
              <p>
                The phone is a focused companion. It never becomes the machine
                that runs your Provider.
              </p>
            </div>
          </div>
          <div className="mobile-point">
            <Bell size={17} />
            <div>
              <strong>Attention travels with you.</strong>
              <p>
                Waiting, completed, and failed work surface in the same durable
                Inbox.
              </p>
            </div>
          </div>
          <div className="mobile-point">
            <Wifi size={17} />
            <div>
              <strong>Remote when you need it.</strong>
              <p>
                Use the existing Host, Node, and Relay boundaries. No cloud IDE
                detour.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function AccountDevicesStory() {
  return (
    <section className="section section-account">
      <SectionIntro
        eyebrow="ACCOUNT + DEVICES"
        title="Find your Hosts. Do not confuse login with trust."
        body="An account helps CodeTether understand which Hosts and ProductDevices belong to you. A Host still decides which device may supervise it, and Machine Controller trust stays separate."
      />
      <div className="account-grid">
        <div className="account-panel light-panel">
          <h3>Your Hosts</h3>
          {[
            ['Desktop PC', 'Personal Space · Windows', 'ONLINE'],
            ['Mac mini', 'Personal Space · macOS', 'ONLINE'],
            ['Home Pi', 'Personal Space · Linux ARM64', 'OFFLINE'],
          ].map(([name, meta, status]) => (
            <div className="host-row" key={name}>
              <div>
                <strong>{name}</strong>
                <small>{meta}</small>
              </div>
              <span className={status === 'ONLINE' ? 'host-online' : ''}>
                {status}
              </span>
            </div>
          ))}
        </div>
        <div className="account-panel dark-panel">
          <h3>Authorized ProductDevices</h3>
          {[
            ['iPhone', 'key generation 2', 'SUPERVISOR READ'],
            ['MacBook', 'key generation 1', 'SUPERVISOR READ'],
            ['Old iPad', 'revoked device', 'REVOKED'],
          ].map(([name, meta, status]) => (
            <div className="device-row" key={name}>
              <strong>{name}</strong>
              <small>{meta}</small>
              <span className={status === 'REVOKED' ? 'device-revoked' : ''}>
                {status}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="separation-callout">
        Account authentication != Host authorization != Machine Controller trust
        != Relay enrollment
      </div>
    </section>
  )
}

export function SecurityArchitecture() {
  return (
    <section className="section section-security-architecture">
      <SectionIntro
        eyebrow="PRIVACY BY AUTHORITY BOUNDARY"
        title="Cloud for identity. Machines for the work."
        body="CodeTether Cloud can know who you are and which Hosts belong to you without becoming the database for source code, prompts, transcripts, terminal output, filesystem paths, or Provider credentials."
        dark
      />
      <div className="security-role-grid">
        {securityRoles.map((role) => (
          <div className={`security-role role-${role.tone}`} key={role.label}>
            <span>{role.label}</span>
            <h3>{role.title}</h3>
            <p>{role.body}</p>
          </div>
        ))}
      </div>
      <div className="security-strip">
        <span>Source code {'->'} your machines</span>
        <span>Provider credentials {'->'} execution machines</span>
        <span>Workspace truth {'->'} Host</span>
        <span>Relay {'->'} transport only</span>
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section className="final-cta">
      <span className="eyebrow eyebrow-violet">
        BUILD HERE. SUPERVISE ANYWHERE.
      </span>
      <h2>
        Your coding agents already know how to work.
        <br />
        CodeTether gives them somewhere to belong.
      </h2>
      <p>
        One workspace across machines, providers, native sessions, desktop, and
        mobile.
      </p>
      <div className="hero-actions">
        <Link className="button button-dark" href="/download">
          Download CodeTether <ArrowRightIcon />
        </Link>
        <Link className="button button-ghost" href="/docs">
          Read the docs
        </Link>
      </div>
    </section>
  )
}

function ArrowRightIcon() {
  return <ArrowUpRight size={15} aria-hidden="true" />
}

export function ProductFeatureList() {
  return (
    <div className="feature-list">
      {productFeatures.map((feature) => (
        <div key={feature}>
          <Check size={15} /> <span>{feature}</span>
        </div>
      ))}
    </div>
  )
}

export { productPillars }
