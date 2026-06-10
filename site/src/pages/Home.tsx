import { Link } from 'react-router-dom'
import { Dodi } from '../components/Dodi'
import { Icon } from '../components/Icon'
import { HeroAirMoment } from '../components/HeroAirMoment'
import { residentsCTA } from '../site.config'

const PANELS = [
  {
    to: '/problem',
    num: '01',
    ico: 'invisible',
    title: 'The Problem',
    desc: 'CO₂ is invisible, it peaks while you sleep, and it quietly dulls your focus.',
  },
  {
    to: '/how',
    num: '02',
    ico: 'loop',
    title: 'How It Works',
    desc: 'Senses → decides → ventilates, automatically, all night. Dodi explains it.',
  },
  {
    to: '/data',
    num: '03',
    ico: 'chart',
    title: 'The Data',
    desc: 'Real overnight CO₂ from Dartmouth dorms, including the runs that prove it.',
  },
  {
    to: '/get-involved',
    num: '04',
    ico: 'sprout',
    title: 'Get Involved',
    desc: 'Want one in your room this fall? Piloting in your buildings? Let’s talk.',
  },
]

export function Home() {
  return (
    <div className="page hero">
      <div className="wrap">
        <div className="sticker">
          <Dodi size={104} className="dodi-float" />
          <div className="sticker-word">Ventis</div>
          <div className="sticker-tag">
            Senses<span className="dot">·</span>Ventilates<span className="dot">·</span>Explains
          </div>
        </div>

        <p className="hero-sub">
          Automatic ventilation for dorms without AC. It pulls <b>cool night air in and the
          CO₂ you can’t feel out,</b> while you sleep.
        </p>

        <div className="hero-actions">
          <Link to="/demo" className="btn btn-primary">
            Try the demo <span className="btn-arrow">→</span>
          </Link>
          <Link to="/data" className="btn btn-ghost">
            See the data
          </Link>
          <a href={residentsCTA} target="_blank" rel="noreferrer" className="btn btn-ghost">
            Get early access
          </a>
        </div>

        <HeroAirMoment />

        <div className="panels">
          {PANELS.map((p) => (
            <Link key={p.to} to={p.to} className="panel">
              <div className="panel-ico ico-badge"><Icon name={p.ico} size={22} /></div>
              <div className="panel-num">{p.num}</div>
              <div className="panel-title">{p.title}</div>
              <div className="panel-desc">{p.desc}</div>
              <div className="panel-go">
                Explore <span className="btn-arrow">→</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
