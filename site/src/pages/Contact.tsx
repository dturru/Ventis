import { useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { CONTACT_EMAIL, WEB3FORMS_KEY } from '../site.config'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Contact() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({})
  const usedMailto = !WEB3FORMS_KEY

  function validate() {
    const e: typeof errors = {}
    if (!name.trim()) e.name = 'Please add your name.'
    if (!email.trim()) e.email = 'Please add an email.'
    else if (!EMAIL_RE.test(email.trim())) e.email = 'That doesn’t look like an email.'
    if (!message.trim()) e.message = 'Tell me a little about what you’re looking for.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return

    // No backend key configured → compose a pre-filled email in the visitor's mail app.
    if (!WEB3FORMS_KEY) {
      const body = `Name: ${name}\nEmail: ${email}\n\n${message}`
      window.location.href =
        `mailto:${CONTACT_EMAIL}` +
        `?subject=${encodeURIComponent('Ventis — pilot / partnership inquiry')}` +
        `&body=${encodeURIComponent(body)}`
      setStatus('sent')
      return
    }

    setStatus('sending')
    try {
      const r = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: 'Ventis — pilot / partnership inquiry',
          from_name: 'Ventis site',
          name,
          email,
          message,
        }),
      })
      const data = await r.json()
      if (data.success) setStatus('sent')
      else setStatus('error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 680 }}>
        <div className="eyebrow">Contact</div>
        <h1 className="section-title">Let’s talk about your buildings.</h1>
        <p className="lede">
          Housing, facilities, or residential operations: if you’re weighing air quality in
          your buildings, tell me a bit and I’ll get back to you. Happy to walk through the data.
        </p>

        <div className="card" style={{ marginTop: 28 }}>
          {status === 'sent' ? (
            <div className="form-sent">
              <div className="check">
                <Icon name="loop" size={26} />
              </div>
              <h3>Thanks — that’s on its way.</h3>
              <p>
                {usedMailto
                  ? 'Your email app should have opened with your message ready to send — just hit send and it’ll reach me directly.'
                  : 'Got it. I’ll be in touch at the email you gave shortly.'}
              </p>
            </div>
          ) : (
            <form className="form" onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="c-name">Name</label>
                <input
                  id="c-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
                {errors.name && <span className="err">{errors.name}</span>}
              </div>

              <div className="field">
                <label htmlFor="c-email">Email</label>
                <input
                  id="c-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@institution.edu"
                  autoComplete="email"
                />
                {errors.email && <span className="err">{errors.email}</span>}
              </div>

              <div className="field">
                <label htmlFor="c-message">Message</label>
                <textarea
                  id="c-message"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="A line about your buildings or what you’re hoping to explore…"
                />
                {errors.message && <span className="err">{errors.message}</span>}
              </div>

              <button type="submit" className="btn btn-primary" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Email me'} <span className="btn-arrow">→</span>
              </button>
              {status === 'error' && (
                <div className="form-status-err">
                  Something went wrong sending that. You can also email me directly at{' '}
                  <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--green)', fontWeight: 600 }}>
                    {CONTACT_EMAIL}
                  </a>
                  .
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
