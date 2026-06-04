import { Link } from 'react-router-dom'

export function Problem() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">The Problem</div>
        <h1 className="section-title">You can’t manage the air you can’t feel.</h1>
        <p className="lede">
          Every Dartmouth dorm was built before central air. Overnight, a closed room
          fills with the CO₂ you breathe back out — and nothing about it feels wrong
          until your sleep and your focus have already paid for it.
        </p>

        <div className="points-grid">
          <div className="point">
            <div className="point-k">01</div>
            <div className="point-h">CO₂ is invisible</div>
            <p className="point-p">
              No human sensation maps to 1,100 ppm. There’s no smell, no alarm, no
              cue. You can’t manage what you can’t measure — so nobody does.
            </p>
          </div>
          <div className="point">
            <div className="point-k">02</div>
            <div className="point-h">It peaks while you sleep</div>
            <p className="point-p">
              The window is a one-shot decision at bedtime. CO₂, outdoor temperature,
              rain and noise all change over the next eight hours — and you’re
              unconscious for every one of them.
            </p>
          </div>
          <div className="point">
            <div className="point-k">03</div>
            <div className="point-h">The cost is real</div>
            <p className="point-p">
              Elevated overnight CO₂ measurably degrades sleep and next-day cognition
              (Harvard’s Healthy Buildings / COGfx work, Joseph Allen). The honest
              framing isn’t “stuffy vs. fresh” — it’s <strong>impaired vs. sharp.</strong>
            </p>
          </div>
        </div>

        <div className="evidence">
          <h2 className="evidence-title">It’s not a comfort issue. It’s a performance issue.</h2>
          <div className="evidence-rows">
            <div className="evidence-row">
              <div className="evidence-src">Lawrence Berkeley National Lab · 2012</div>
              <p>
                At 1,000 ppm, <strong>6 of 9 decision-making scores dropped measurably</strong>{' '}
                versus clean air — the exact level we recorded in a Dartmouth dorm, all night.
              </p>
            </div>
            <div className="evidence-row">
              <div className="evidence-src">Bedroom ventilation field study · 2023</div>
              <p>
                Ventilating a bedroom overnight (CO₂ from 2,585 → 660 ppm) produced{' '}
                <strong>significant next-day cognitive gains</strong> — ventilate at night, and
                you perform better the next day.
              </p>
            </div>
          </div>
          <p className="evidence-foot">
            For a student, that’s focus, studying, and exam performance. For a college, it’s
            academic performance you can measure — building by building.
          </p>
        </div>

        <div className="prose">
          <h2 className="section-title" style={{ fontSize: 26, marginTop: 8 }}>
            “Why not just open a window?”
          </h2>
          <p>
            A window is <strong>excellent</strong> ventilation — Ventis doesn’t claim to
            beat one on physics. It competes against human behavior. An open window only
            works <em>if</em> you know when you need it and you’re awake to act on it. For
            the eight hours that matter, you’re neither.
          </p>
          <p>
            And for seven months a year in Hanover, an open window overnight means a
            freezing room. The real student choice is “freeze vs. stuffy,” and people
            reliably pick warm — exactly when ventilation is needed most.
          </p>
        </div>

        <div className="callout">
          We watched a real occupant do exactly this: window open and ventilating
          perfectly at ~650 ppm, then closed at bedtime for warmth — and CO₂ climbed all
          night, even with the fan running. The free option was right there, and a real
          person turned it off. <Link to="/data" style={{ color: 'var(--green)', fontWeight: 600 }}>See that run →</Link>
        </div>

        <div className="callout amber">
          <strong>We’re honest about the limit.</strong> CO₂ only leaves through air
          exchange with outdoors — filters and AC don’t remove it. So v1/v2 are a
          shoulder-season product; the year-round winter answer is heat-recovery
          ventilation (v3). We don’t pretend otherwise.
        </div>

        <div className="sources">
          <h3>Sources</h3>
          <ol>
            <li>
              Satish, U. et al. (2012). “Is CO₂ an Indoor Pollutant? Direct Effects of
              Low-to-Moderate CO₂ Concentrations on Human Decision-Making Performance.”{' '}
              <em>Environmental Health Perspectives</em> 120(12): 1671–1677.{' '}
              <a href="https://pubmed.ncbi.nlm.nih.gov/23008272/" target="_blank" rel="noreferrer noopener">pubmed.ncbi.nlm.nih.gov/23008272</a>
            </li>
            <li>
              Allen, J.G. et al. (2016). “Associations of Cognitive Function Scores with
              Carbon Dioxide, Ventilation, and Volatile Organic Compound Exposures in Office
              Workers” (the Harvard “COGfx” study). <em>Environmental Health Perspectives</em>{' '}
              124(6): 805–812.{' '}
              <a href="https://pubmed.ncbi.nlm.nih.gov/26502459/" target="_blank" rel="noreferrer noopener">pubmed.ncbi.nlm.nih.gov/26502459</a>
            </li>
            <li>
              “Short-term exposure to indoor carbon dioxide and cognitive task performance:
              a systematic review and meta-analysis.” <em>Building and Environment</em> (2023).{' '}
              <a href="https://www.sciencedirect.com/science/article/pii/S036013232300358X" target="_blank" rel="noreferrer noopener">sciencedirect.com</a>
            </li>
            <li>
              “Ventilation causing an average CO₂ concentration of 1,000 ppm negatively
              affects sleep: a field-lab study on healthy young people.”{' '}
              <em>Building and Environment</em> (2023).{' '}
              <a href="https://www.sciencedirect.com/science/article/pii/S0360132323011459" target="_blank" rel="noreferrer noopener">sciencedirect.com</a>
            </li>
            <li>
              “Ventilate your bedroom at night. You perform better the next day.” (2023) —
              overnight bedroom ventilation (CO₂ 2,585 → 660 ppm) and next-day cognitive
              performance.{' '}
              <a href="https://www.eurekalert.org/news-releases/988687" target="_blank" rel="noreferrer noopener">eurekalert.org/news-releases/988687</a>
            </li>
            <li>
              ASHRAE. “Position Document on Indoor Carbon Dioxide” (2022) — basis for the
              ~1,000 ppm indoor-air benchmark used throughout this site.{' '}
              <a href="https://www.ashrae.org/file%20library/about/position%20documents/pd-on-indoor-carbon-dioxide-english.pdf" target="_blank" rel="noreferrer noopener">ashrae.org</a>
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
