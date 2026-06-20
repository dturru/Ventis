import { Link } from 'react-router-dom'

// Superscript footnote marker → jumps to the matching numbered reference below.
function Cite({ n }: { n: number }) {
  return (
    <sup className="cite-wrap">
      <a href={`#ref-${n}`} className="cite" aria-label={`See reference ${n}`}>
        {n}
      </a>
    </sup>
  )
}

export function Problem() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">The Problem</div>
        <h1 className="section-title">You can’t manage the air you can’t feel.</h1>
        <p className="lede">
          Most Dartmouth dorms predate central air. Overnight, a closed room fills with
          the CO₂ you breathe back out. Nothing about it feels wrong, and by the time it
          does, your sleep and your focus have already paid for it.
        </p>

        <div className="points-grid">
          <div className="point">
            <div className="point-k">01</div>
            <div className="point-h">CO₂ is invisible</div>
            <p className="point-p">
              You can’t feel 1,100 ppm of CO₂. No smell, no alarm, no warning. You
              can’t manage what you can’t measure, so nobody does.
            </p>
          </div>
          <div className="point">
            <div className="point-k">02</div>
            <div className="point-h">It peaks while you sleep</div>
            <p className="point-p">
              The window is a one-shot decision at bedtime. CO₂, outdoor temperature,
              rain, and noise all shift over the next eight hours, and you’re unconscious
              for every one of them.
            </p>
          </div>
          <div className="point">
            <div className="point-k">03</div>
            <div className="point-h">The cost is real</div>
            <p className="point-p">
              Elevated overnight CO₂ measurably degrades sleep<Cite n={4} /> and next-day
              cognition<Cite n={2} /><Cite n={3} /> (Harvard’s Healthy Buildings / COGfx work,
              Joseph Allen). The cost lands the next day, in <strong>focus you can’t get
              back.</strong>
            </p>
          </div>
        </div>

        <div className="evidence">
          <h2 className="evidence-title">It’s not a comfort issue. It’s a performance issue.</h2>
          <div className="evidence-rows">
            <div className="evidence-row">
              <div className="evidence-src">Lawrence Berkeley National Lab · 2012</div>
              <p>
                At 1,000 ppm<Cite n={6} />, <strong>6 of 9 decision-making scores dropped
                measurably</strong><Cite n={1} /> versus clean air. That’s the exact level we
                recorded in a Dartmouth dorm, all night.
              </p>
            </div>
            <div className="evidence-row">
              <div className="evidence-src">Bedroom ventilation field study · 2023</div>
              <p>
                Ventilating a bedroom overnight (CO₂ from 2,585 → 660 ppm) produced{' '}
                <strong>significant next-day cognitive gains</strong><Cite n={5} />. Ventilate
                at night, and you perform better the next day.
              </p>
            </div>
          </div>
          <p className="evidence-foot">
            For a student, that’s focus, studying, and exam performance. For a college, it’s
            academic performance you can measure, building by building.
          </p>
        </div>

        <div className="prose">
          <h2 className="section-title" style={{ fontSize: 26, marginTop: 8 }}>
            “Why not just open a window?”
          </h2>
          <p>
            A window is <strong>excellent</strong> ventilation. Ventis doesn’t claim to beat
            one on physics; it competes against human behavior. An open window only works{' '}
            <em>if</em> you know when you need it and you’re awake to act. For the eight hours
            that matter, you’re neither.
          </p>
          <p>
            And for seven months a year in Hanover, an open window overnight means a freezing
            room. The real choice is freeze or stuffy, and people pick warm every time, right
            when ventilation matters most.
          </p>
        </div>

        <div className="callout">
          We watched a real occupant do exactly this. Window open and ventilating fine at
          ~650 ppm, then closed at bedtime for warmth, and the CO₂ climbed all night with the
          fan running the whole time. The free option was right there, and a real person
          turned it off. <Link to="/data" style={{ color: 'var(--green)', fontWeight: 600 }}>See that run →</Link>
        </div>

        <div className="callout amber">
          <strong>The limit, stated plainly.</strong> CO₂ only leaves a room through air
          exchange with the outdoors; filters and AC don’t remove it. So v1 and v2 are a
          shoulder-season product, and the year-round winter answer is heat-recovery
          ventilation (v3).
        </div>

        <div className="sources" id="sources">
          <h3>Sources</h3>
          <ol>
            <li id="ref-1">
              Satish, U. et al. (2012). “Is CO₂ an Indoor Pollutant? Direct Effects of
              Low-to-Moderate CO₂ Concentrations on Human Decision-Making Performance.”{' '}
              <em>Environmental Health Perspectives</em> 120(12): 1671–1677.{' '}
              <a href="https://pubmed.ncbi.nlm.nih.gov/23008272/" target="_blank" rel="noreferrer noopener">pubmed.ncbi.nlm.nih.gov/23008272</a>
            </li>
            <li id="ref-2">
              Allen, J.G. et al. (2016). “Associations of Cognitive Function Scores with
              Carbon Dioxide, Ventilation, and Volatile Organic Compound Exposures in Office
              Workers” (the Harvard “COGfx” study). <em>Environmental Health Perspectives</em>{' '}
              124(6): 805–812.{' '}
              <a href="https://pubmed.ncbi.nlm.nih.gov/26502459/" target="_blank" rel="noreferrer noopener">pubmed.ncbi.nlm.nih.gov/26502459</a>
            </li>
            <li id="ref-3">
              “Short-term exposure to indoor carbon dioxide and cognitive task performance:
              a systematic review and meta-analysis.” <em>Building and Environment</em> (2023).{' '}
              <a href="https://www.sciencedirect.com/science/article/pii/S036013232300358X" target="_blank" rel="noreferrer noopener">sciencedirect.com</a>
            </li>
            <li id="ref-4">
              “Ventilation causing an average CO₂ concentration of 1,000 ppm negatively
              affects sleep: a field-lab study on healthy young people.”{' '}
              <em>Building and Environment</em> (2023).{' '}
              <a href="https://www.sciencedirect.com/science/article/pii/S0360132323011459" target="_blank" rel="noreferrer noopener">sciencedirect.com</a>
            </li>
            <li id="ref-5">
              “Ventilate your bedroom at night. You perform better the next day.” (2023).
              Overnight bedroom ventilation (CO₂ 2,585 → 660 ppm) and next-day cognitive
              performance.{' '}
              <a href="https://www.eurekalert.org/news-releases/988687" target="_blank" rel="noreferrer noopener">eurekalert.org/news-releases/988687</a>
            </li>
            <li id="ref-6">
              ASHRAE. “Position Document on Indoor Carbon Dioxide” (2022). Basis for the
              ~1,000 ppm indoor-air benchmark used throughout this site.{' '}
              <a href="https://www.ashrae.org/file%20library/about/position%20documents/pd-on-indoor-carbon-dioxide-english.pdf" target="_blank" rel="noreferrer noopener">ashrae.org</a>
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
