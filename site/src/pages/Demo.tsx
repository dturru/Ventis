import { Link } from 'react-router-dom'
import { DeviceDemo } from '../components/DeviceDemo'

export function Demo() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">Interactive Demo</div>
        <h1 className="section-title">The Ventis dashboard, live.</h1>
        <p className="lede">
          At our booth you can breathe on the sensor and watch CO₂ climb, the fan kick on, and
          Dodi react in about thirty seconds. Here’s the next best thing: this is the actual
          on-device app. Press play to replay a real overnight run, and scrub anywhere in the
          night. No hardware needed.
        </p>

        <DeviceDemo />

        <p className="prose" style={{ color: 'var(--muted)', marginTop: 28 }}>
          Want the other nights? The{' '}
          <Link to="/data" style={{ color: 'var(--green)', fontWeight: 600 }}>data page</Link>{' '}
          has every run we’ve measured: Choates, the apartment, East Wheelock. All real, none
          simulated.
        </p>
      </div>
    </div>
  )
}
