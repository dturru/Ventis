import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { residentsCTA } from '../site.config'

export function GetInvolved() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 900 }}>
        <div className="eyebrow">Get Involved</div>
        <h1 className="section-title">Better air in your building.</h1>
        <p className="lede">
          Ventis is early, and we’re building it with the people who’ll use it. Two ways in.
        </p>

        <div className="cta-grid">
          <div className="cta-card feature">
            <div className="ico"><Icon name="bed" size={26} /></div>
            <h3>Residents</h3>
            <p>
              Want one this fall? Early access is for the <strong>v2 window unit</strong>, the
              first integrated units, expected Fall 2026. Leave your info to be first in line,
              and to see your own room’s overnight numbers.
            </p>
            <a className="btn" href={residentsCTA} target="_blank" rel="noreferrer">
              Get early access →
            </a>
          </div>

          <div className="cta-card">
            <div className="ico"><Icon name="building" size={26} /></div>
            <h3>Institutions</h3>
            <p>
              Housing, facilities, or residential operations team piloting air quality in
              your buildings? We’d love to show you the data and talk about a pilot.
            </p>
            <Link className="btn btn-primary" to="/contact">
              Start a conversation →
            </Link>
          </div>
        </div>

        <div className="callout">
          <strong>Where this is headed.</strong> Today Ventis is a per-room device that
          makes invisible air visible. The bigger picture is a building-level view: the same
          measured data, aggregated and anonymized, so the people who run residential
          buildings can finally see what their students breathe.
        </div>

        <p className="data-note">
          We’re early and don’t have pricing yet; this is about interest and fit, not a sale.
          We never share your email.
        </p>
      </div>
    </div>
  )
}
