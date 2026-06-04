import { Routes, Route, useLocation, Link } from 'react-router-dom'
import { useEffect } from 'react'
import { Nav } from './components/Nav'
import { Home } from './pages/Home'
import { Problem } from './pages/Problem'
import { How } from './pages/How'
import { Data } from './pages/Data'
import { Demo } from './pages/Demo'
import { GetInvolved } from './pages/GetInvolved'
import { Contact } from './pages/Contact'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div>
          <div className="footer-brand">Ventis</div>
          <p className="footer-note">
            Automatic, sensing-driven ventilation for dorm rooms that don't have it.
            v1 and v2 are a shoulder-season product; year-round CO₂ needs metered air
            exchange (v2) and heat recovery (v3). Built at Dartmouth.
          </p>
        </div>
        <div className="footer-links">
          <Link to="/problem">The Problem</Link>
          <Link to="/how">How It Works</Link>
          <Link to="/data">The Data</Link>
          <Link to="/get-involved">Get Involved</Link>
          <Link to="/contact">Contact</Link>
        </div>
      </div>
    </footer>
  )
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/problem" element={<Problem />} />
          <Route path="/how" element={<How />} />
          <Route path="/data" element={<Data />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/get-involved" element={<GetInvolved />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
