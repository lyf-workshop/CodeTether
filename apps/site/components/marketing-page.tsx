import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowUpRight,
  Check,
  Download,
  LockKeyhole,
  Smartphone,
  Terminal,
  Wifi,
} from 'lucide-react'
import { ProductFeatureList } from './sections'
import { siteConfig } from '../lib/site-config'

export function PageHero({
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
    <section className={`page-hero ${dark ? 'page-hero-dark' : ''}`}>
      <span className="eyebrow eyebrow-cyan">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  )
}

function FeatureSection({
  eyebrow,
  title,
  body,
  children,
  reverse = false,
}: {
  eyebrow: string
  title: string
  body: string
  children: React.ReactNode
  reverse?: boolean
}) {
  return (
    <section
      className={`detail-section ${reverse ? 'detail-section-reverse' : ''}`}
    >
      <div className="detail-copy">
        <span className="eyebrow eyebrow-violet">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <div className="detail-visual">{children}</div>
    </section>
  )
}

export function ProductPageContent() {
  return (
    <>
      <PageHero
        eyebrow="THE PRODUCT"
        title="A control plane for the work your agents already do."
        body="CodeTether gives projects, conversations, machines, providers, native sessions, and supervision one durable workspace."
      />
      <div className="detail-content">
        <FeatureSection
          eyebrow="WORKSPACE"
          title="Projects and Conversations stay connected."
          body="Organize the codebases agents work in, keep durable Conversation history, and find the exact question or attention state that needs you."
        >
          <div className="detail-window detail-window-image">
            <Image
              src="/product/codetether-workspace.png"
              alt="Real CodeTether desktop workspace capture"
              fill
              sizes="(max-width: 900px) 100vw, 48vw"
            />
            <span className="capture-caption">REAL DESKTOP WORKSPACE</span>
          </div>
        </FeatureSection>
        <FeatureSection
          eyebrow="MACHINES + PROVIDERS"
          title="Make runtime choices explicit."
          body="Machines describe where work runs. Providers describe who performs it. A selected installation remains bound to its Conversation, with no silent fallback."
          reverse
        >
          <div className="detail-runtime">
            <div className="detail-runtime-row">
              <span className="status-dot green" />
              <div>
                <strong>Windows Desktop</strong>
                <small>Codex 0.47.1 · selected</small>
              </div>
              <b>READY</b>
            </div>
            <div className="detail-runtime-row">
              <span className="status-dot cyan" />
              <div>
                <strong>Mac mini</strong>
                <small>Claude Code 2.1.x · authenticated</small>
              </div>
              <b>READY</b>
            </div>
            <div className="detail-runtime-row muted-row">
              <span className="status-dot muted" />
              <div>
                <strong>Home Pi</strong>
                <small>Linux ARM64 · offline</small>
              </div>
              <b>LAST KNOWN</b>
            </div>
            <div className="runtime-footnote">
              <LockKeyhole size={14} /> Machine identity is durable. Network
              address is not.
            </div>
          </div>
        </FeatureSection>
        <FeatureSection
          eyebrow="CONTINUITY"
          title="Discover. Adopt. Resume."
          body="Provider-native history stays Provider-owned. CodeTether gives you a safe reference in the workspace, then continues through the native session mechanism on an explicit user action."
        >
          <div className="detail-steps">
            <div>
              <span>01</span>
              <strong>Discover</strong>
              <small>Read-only session metadata</small>
            </div>
            <div>
              <span>02</span>
              <strong>Adopt</strong>
              <small>One durable workspace reference</small>
            </div>
            <div>
              <span>03</span>
              <strong>Resume</strong>
              <small>Native Provider continuation</small>
            </div>
          </div>
        </FeatureSection>
        <FeatureSection
          eyebrow="SUPERVISION"
          title="Stay close without staying at the desk."
          body="Background sessions, attention states, notifications, and the Mobile Supervisor keep work visible while execution remains on the original Host or Node."
          reverse
        >
          <div className="detail-supervision">
            <div className="detail-supervision-row">
              <Terminal size={16} />
              <span>Mac mini · Claude</span>
              <b className="wait-text">WAITING</b>
            </div>
            <div className="detail-supervision-row">
              <Wifi size={16} />
              <span>Relay connection</span>
              <b className="ready-text">CONNECTED</b>
            </div>
            <div className="detail-supervision-row">
              <Smartphone size={16} />
              <span>iPhone Supervisor</span>
              <b className="ready-text">ATTENTION</b>
            </div>
          </div>
        </FeatureSection>
      </div>
      <section className="product-feature-band">
        <div>
          <span className="eyebrow eyebrow-cyan">AT A GLANCE</span>
          <h2>The pieces fit together without becoming another agent.</h2>
        </div>
        <ProductFeatureList />
      </section>
      <section className="simple-cta">
        <h2>See the boundaries before you connect a machine.</h2>
        <Link className="button button-dark" href="/security">
          Read the security model <ArrowUpRight size={15} />
        </Link>
      </section>
    </>
  )
}

export function SecurityPageContent() {
  const boundaries = [
    [
      'Account',
      'Human identity and ownership claims.',
      'Your login does not grant execution access by itself.',
    ],
    [
      'ProductDevice',
      'A device key authorized to supervise.',
      'Revocation is explicit and separate from account auth.',
    ],
    [
      'Host',
      'The durable workspace authority.',
      'Projects, Conversations, Turns, and Provider selection stay local.',
    ],
    [
      'Machine trust',
      'A pinned Controller <-> Node relationship.',
      'Pairing is explicit and transport is authenticated.',
    ],
    [
      'Relay',
      'Opaque rendezvous and transport.',
      'Relay never becomes workspace or Provider authority.',
    ],
  ]
  return (
    <>
      <PageHero
        dark
        eyebrow="SECURITY ARCHITECTURE"
        title="Cloud for identity. Machines for the work."
        body="Security in CodeTether is a set of authority boundaries. Each layer owns one thing, and none of them quietly becomes the other."
      />
      <section className="security-boundary-section">
        <div className="boundary-intro">
          <span className="eyebrow eyebrow-violet">FIVE SEPARATE ROLES</span>
          <h2>Trust is not one green dot.</h2>
          <p>
            Account authentication, ProductDevice authorization, Host ownership,
            Machine Controller trust, and Relay enrollment answer different
            questions.
          </p>
        </div>
        <div className="boundary-list">
          {boundaries.map(([title, desc, detail], index) => (
            <div className="boundary-row" key={title}>
              <span className="boundary-index">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{desc}</p>
                <small>{detail}</small>
              </div>
              <Check size={16} />
            </div>
          ))}
        </div>
      </section>
      <section className="security-privacy">
        <div>
          <span className="eyebrow eyebrow-cyan">PRIVACY BOUNDARY</span>
          <h2>What CodeTether Cloud is not meant to store.</h2>
        </div>
        <div className="privacy-list">
          <span>Source code</span>
          <span>Provider credentials</span>
          <span>Prompts and transcripts</span>
          <span>Terminal output</span>
          <span>Raw diffs</span>
          <span>Filesystem paths</span>
        </div>
      </section>
      <section className="simple-cta">
        <h2>Build where your code lives. Supervise from anywhere.</h2>
        <Link className="button button-dark" href="/download">
          Explore downloads <Download size={15} />
        </Link>
      </section>
    </>
  )
}

export function DownloadPageContent() {
  const targets = [
    ['Windows Desktop', 'Host + desktop workspace', 'windows'],
    ['macOS', 'Desktop and Node support', 'macos'],
    ['Linux ARM64', 'Node for remote machines', 'linux'],
    ['Mobile Supervisor', 'iOS and Android companion', 'ios'],
  ] as const
  return (
    <>
      <PageHero
        eyebrow="DOWNLOAD"
        title="Put CodeTether next to the code."
        body="Release downloads will appear here as they are published. This page intentionally does not invent installer URLs."
      />
      <section className="download-grid">
        {targets.map(([name, body, key]) => (
          <div className="download-card" key={name}>
            <div>
              <span className="download-platform">
                {key === 'linux' ? 'ARM64' : key.toUpperCase()}
              </span>
              <h2>{name}</h2>
              <p>{body}</p>
            </div>
            {siteConfig.downloads[key] ? (
              <a
                className="button button-dark"
                href={siteConfig.downloads[key] as string}
              >
                Download <Download size={15} />
              </a>
            ) : (
              <span className="download-unavailable">Coming at launch</span>
            )}
          </div>
        ))}
      </section>
      <section className="download-note">
        <LockKeyhole size={18} />
        <p>
          CodeTether keeps Provider credentials on execution machines and does
          not turn a download page into a cloud execution promise.
        </p>
      </section>
    </>
  )
}

export function DocsPageContent() {
  const categories = [
    'Getting Started',
    'Projects',
    'Conversations',
    'Machines',
    'Providers',
    'Provider Installations',
    'Native Sessions',
    'Remote Nodes',
    'Relay',
    'Mobile Supervisor',
    'Account & Devices',
    'Security',
  ]
  return (
    <>
      <PageHero
        eyebrow="DOCUMENTATION"
        title="Understand the workspace before you run it everywhere."
        body="A focused guide to the objects, boundaries, and workflows that make CodeTether useful across machines."
      />
      <section className="docs-grid">
        {categories.map((category, index) => (
          <Link href="/docs" className="docs-card" key={category}>
            <span>0{index + 1}</span>
            <h2>{category}</h2>
            <ArrowUpRight size={17} />
            <p>Read the CodeTether model and the decisions behind it.</p>
          </Link>
        ))}
      </section>
      <section className="simple-cta">
        <h2>Start with the product story.</h2>
        <Link className="button button-dark" href="/product">
          Explore Product <ArrowUpRight size={15} />
        </Link>
      </section>
    </>
  )
}

export function SignInPageContent() {
  return (
    <section className="auth-page">
      <div className="auth-shell">
        <img src="/brand/codetether-mark.svg" alt="" width={32} height={32} />
        <span className="eyebrow eyebrow-violet">CODETETHER ACCOUNT</span>
        <h1>Sign in to find your Hosts.</h1>
        <p>
          This is the visual shell for the future account flow. Human
          authentication will use the approved Supabase Auth boundary.
        </p>
        <button type="button" className="button button-dark" disabled>
          Sign in <ArrowUpRight size={15} />
        </button>
        <small>
          Account authentication does not replace Host authorization or Machine
          Controller trust.
        </small>
      </div>
    </section>
  )
}

export function LegalPageContent({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy'
  return (
    <>
      <PageHero
        eyebrow={privacy ? 'PRIVACY PREVIEW' : 'TERMS PREVIEW'}
        title={
          privacy
            ? 'A clear boundary around your work.'
            : 'A straightforward preview for launch review.'
        }
        body="This preview is intentionally not a substitute for final legal review. Product and company details will be finalized before publication."
      />
      <section className="legal-content">
        <span className="eyebrow eyebrow-cyan">PREVIEW CONTENT</span>
        <h2>
          {privacy
            ? 'Machines keep the work.'
            : 'Use CodeTether as a control plane.'}
        </h2>
        <p>
          {privacy
            ? 'CodeTether is designed around keeping source code, Provider credentials, prompts, transcripts, and raw execution output on the machines where work runs. Cloud services may handle identity, ownership, revocation, and bounded rendezvous without becoming workspace storage.'
            : 'CodeTether brings supported coding agents into one workspace while preserving Provider-native execution and history. The final terms will describe availability, acceptable use, and launch support after legal review.'}
        </p>
        <p>
          Replace this preview with reviewed launch language before the public
          site is deployed.
        </p>
      </section>
    </>
  )
}
