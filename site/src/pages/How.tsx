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
          Ventis runs a simple closed loop, automatically, while you sleep — and tells
          you what it’s doing in plain English.
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
            <p>Pulls fresh outdoor air through the window. CO₂ drops; you stay asleep through all of it.</p>
          </div>
        </div>

        <div className="dodi-says">
          <Dodi size={72} />
          <div className="bubble">
            <div className="who">Dodi · your room’s air, narrated</div>
            <p>
              “I watch the numbers you can’t feel. When the CO₂ you’re breathing back in
              starts to climb, I check whether the air outside will actually help — and if
              it will, I open things up and pull it in. I only run when it’s worth the
              noise. You just wake up sharp.”
            </p>
          </div>
        </div>

        <div className="prose">
          <h2 className="section-title" style={{ fontSize: 26 }}>The closed loop</h2>
          <p>
            CO₂ rises as you sleep → Ventis exchanges it for outdoor air → CO₂ falls. The
            decision is <strong>temperature-aware</strong>: if the outdoor air is colder
            than it’s worth, Ventis meters the exchange instead of dumping a freezing draft
            into the room.
          </p>
          <p>
            One honest caveat we never hide: moving air around a closed room (recirculation)
            does <strong>not</strong> lower CO₂ — only exchange with outdoors does. Our own
            data proves it. That’s why Ventis is built around the window, not around a fan.
          </p>
        </div>
      </div>
    </div>
  )
}
