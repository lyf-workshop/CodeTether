import Link from 'next/link'
import { ArrowRight, Play } from 'lucide-react'
import { HeroProductWindow } from './hero-product-window'

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <span className="eyebrow eyebrow-violet">
          CONTROL YOUR CODING AGENTS ACROSS DEVICES
        </span>
        <h1 id="hero-title">
          Keep the agents on your machines.
          <br />
          Take the control plane everywhere.
        </h1>
        <p>
          Run Codex and Claude Code where your code already lives. CodeTether
          keeps projects, conversations, machines, providers, and remote
          supervision in one place.
        </p>
        <div className="hero-actions">
          <Link className="button button-dark" href="/download">
            Download CodeTether <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <a className="button button-ghost" href="#how-it-works">
            <Play size={14} fill="currentColor" aria-hidden="true" /> Watch
            product tour
          </a>
        </div>
        <div className="provider-pills" aria-label="Supported providers">
          <span>Codex</span>
          <span>Claude Code</span>
        </div>
      </div>
      <div className="hero-stage-wrap">
        <div className="hero-stage">
          <div
            className="hero-stage-glow hero-stage-glow-left"
            aria-hidden="true"
          />
          <div
            className="hero-stage-glow hero-stage-glow-right"
            aria-hidden="true"
          />
          <div className="motion-note motion-note-top">
            Windows Host <strong>LIVE</strong>
          </div>
          <div className="motion-note motion-note-right">
            Mac Node <strong>VERIFIED</strong>
          </div>
          <div className="motion-note motion-note-bottom">
            Mobile Supervisor <strong>ATTENTION</strong>
          </div>
          <HeroProductWindow />
          <div className="stage-story" aria-live="polite">
            <span className="story-state story-state-one">
              Agent is working on Windows
            </span>
            <span className="story-state story-state-two">
              Remote Mac joins through Relay
            </span>
            <span className="story-state story-state-three">
              A mobile supervisor gets attention
            </span>
            <span className="story-state story-state-four">
              Work completes. Result is yours.
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
