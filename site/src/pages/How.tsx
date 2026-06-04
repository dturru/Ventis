import { Dodi } from '../components/Dodi'
import { Icon } from '../components/Icon'

function Chevron() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

export function How() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">How It Works</div>
        <h1 className="section-title">Senses. Ventilates. Explains.</h1>
        <p className="lede">
          Ventis runs a simple closed loop while you sleep, and tells you what it’s
          doing in plain English.
        </p>

        <div className="flow">
          <div className="flow-step">
            <div className="big"><Icon name="sense" size={28} /></div>
            <h4>Senses</h4>
            <p>Reads CO₂, temperature and humidity in your room — and the air outside — every few seconds.</p>
          </div>
          <div className="flow-arrow"><Chevron /></div>
          <div className="flow-step">
            <div className="big"><Icon name="decide" size={28} /></div>
            <h4>Decides</h4>
            <p>Ventilates only when it’s worth it — when outdoor air will actually cool the room or clear the CO₂.</p>
          </div>
          <div className="flow-arrow"><Chevron /></div>
          <div className="flow-step">
            <div className="big"><Icon name="wind" size={28} /></div>
            <h4>Ventilates</h4>
            <p>Pulls cooler outdoor air through the window. The room cools, the CO₂ drops, and you sleep through all of it.</p>
          </div>
        </div>

        <div className="dodi-says">
          <Dodi size={72} />
          <div className="bubble">
            <div className="who">Dodi · your room’s air, narrated</div>
            <p>
              “I watch the things you can’t feel. When your room’s warming up and the air
              outside is cooler, I pull that in for you — and I do the same when the CO₂
              you’re breathing back in starts to climb. I only run when it’s actually worth
              it. You just wake up cool and sharp.”
            </p>
          </div>
        </div>

        <div className="eyebrow" style={{ marginTop: 8 }}>What you actually feel</div>
        <div className="feels">
          <div className="feel">
            <div className="feel-ico ico-badge"><Icon name="wind" size={20} /></div>
            <h4>Cooler nights, automatically</h4>
            <p>
              When it’s cooler outside than in your room — most summer nights and early
              mornings — Ventis pulls that air in for you. It’s the free cooling already
              outside your window, captured at the right moment instead of depending on you
              to remember the sash. The moving air reads as a breeze, too.
            </p>
          </div>
          <div className="feel">
            <div className="feel-ico ico-badge"><Icon name="invisible" size={20} /></div>
            <h4>Air you can’t feel, handled</h4>
            <p>
              It clears the CO₂ that builds while you sleep — no smell, no sensation, but it
              quietly dulls next-day focus.
            </p>
          </div>
        </div>
        <p className="feels-note">
          Because it’s ventilation, not refrigeration, Ventis can’t cool below the outside
          air. But it never blows hot afternoon air in either, and it runs only when the air
          outdoors will actually help.
        </p>

        <div className="prose">
          <h2 className="section-title" style={{ fontSize: 26 }}>The closed loop</h2>
          <p>
            CO₂ rises as you sleep → Ventis exchanges it for outdoor air → CO₂ falls. The
            decision is <strong>temperature-aware</strong>: if the outdoor air is colder
            than it’s worth, Ventis meters the exchange instead of dumping a freezing draft
            into the room.
          </p>
          <p>
            One caveat we don’t hide: moving air around a closed room (recirculation) does
            <strong> not</strong> lower CO₂. Only exchange with the outdoors does, and our own
            data shows it. That’s why Ventis is built around the window, not the fan.
          </p>
        </div>

        {/* ── The hardware, today ─────────────────────────────────────────── */}
        <div className="eyebrow" style={{ marginTop: 40 }}>The hardware, today</div>
        <h2 className="section-title" style={{ fontSize: 26 }}>A working prototype, not a render</h2>
        <figure className="hw-shot">
          <img
            src="/hardware-v1.jpg"
            alt="The Ventis v1 prototype on a desk by a window: a 3D-printed controller with a live CO₂ display, next to twin 120 mm fans and a small outdoor sensor node."
            loading="lazy"
            width={1600}
            height={1200}
          />
          <figcaption>
            The Ventis <strong>v1 prototype.</strong> It already does the whole job: senses
            the air, decides, and drives the fan, with hours of real dorm CO₂ data behind it.
            The controller (left) reads CO₂, temperature, and humidity and shows the live
            number; the small node (right) watches the air outside. The integrated window-duct
            unit is in development.
          </figcaption>
        </figure>

        {/* ── Where Ventis is headed ──────────────────────────────────────── */}
        <div className="eyebrow" style={{ marginTop: 40 }}>Where Ventis is headed</div>
        <h2 className="section-title" style={{ fontSize: 26 }}>From prototype to window unit</h2>
        <div className="roadmap">
          <div className="rm">
            <div className="rm-k">v1</div>
            <div className="rm-when">Today</div>
            <h4>Working prototype</h4>
            <p>
              Controller, sensors and fan running the full sense → decide → ventilate loop,
              with real overnight dorm CO₂ data behind it.
            </p>
          </div>
          <div className="rm featured">
            <div className="rm-badge">Next up</div>
            <div className="rm-k">v2</div>
            <div className="rm-when">First units expected Fall 2026 · target</div>
            <h4>The window unit</h4>
            <p>
              A windowsill duct piece your sash seals down onto by its own weight, twin
              intake/exhaust ducts, and all the brains in one quiet indoor box. Hand-removable
              in seconds and built to keep your window’s emergency egress clear. Double-hung
              windows first.
            </p>
          </div>
          <div className="rm">
            <div className="rm-k">v3</div>
            <div className="rm-when">The vision</div>
            <h4>Heat recovery</h4>
            <p>
              A heat-recovery core so fresh air keeps coming through Hanover winter — without
              throwing your warmth out the window with it.
            </p>
          </div>
        </div>
        <p className="feels-note">
          Dates are targets, not promises; v2 depends on dorm window measurements and housing
          review. And to be clear about what Ventis is: no heating element, no refrigerant, no
          compressor. It’s a ventilator, not an air conditioner.
        </p>
      </div>
    </div>
  )
}
