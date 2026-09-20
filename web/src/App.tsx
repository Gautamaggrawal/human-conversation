import { useState, useEffect, useRef, type ReactElement } from 'react'
import {
  sendOTP,
  verifyOTP,
  updateProfile,
  ensureCredits,
  submitRating,
  getToken,
  clearToken,
  fetchMe,
  authMode,
  refreshSessionIfNeeded,
  consumeAuthRedirect,
  fetchAvailableListeners,
  fetchFavorites,
  fetchCalls,
  type PersonDTO,
} from './lib/api'
import { signaling } from './lib/signaling'
import { BrowserAudioCall, MicPermissionError, getMicrophoneStream, type CallConnectionState } from './lib/webrtc'
import { goListenerOnline, goListenerOffline, ensureListenerPresence, isListenerAvailablePreferred } from './lib/listener'

// ---------------------------------------------------------------------------
// Auth screens
// ---------------------------------------------------------------------------

function WelcomeScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col h-full px-8" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 flex flex-col justify-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-10"
          style={{ background: '#F5E8DF' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C4622D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0118 0v6" />
            <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5z" />
            <path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z" />
          </svg>
        </div>
        <h1 className="font-bold leading-tight mb-4" style={{ fontSize: 36, color: '#1A1714', letterSpacing: '-0.03em' }}>
          Whenever you want to talk, there's a real person ready.
        </h1>
        <p style={{ color: '#9C9590', fontSize: 16, lineHeight: 1.6 }}>
          No feed. No followers. Just a genuine conversation with another human being.
        </p>
      </div>
      <div className="pb-12">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg transition-all active:scale-95"
          style={{ background: '#C4622D', boxShadow: '0 4px 24px rgba(196,98,45,0.28)' }}
          onClick={onNext}
        >
          Get started
        </button>
        <p className="text-center text-xs mt-4" style={{ color: '#C8C4BE' }}>
          By continuing, you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </div>
  )
}

type EmailState = 'idle' | 'sending' | 'error_network'

function EmailScreen({ onSent }: { onSent: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<EmailState>('idle')

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function handleSubmit() {
    if (!valid || state === 'sending') return
    setState('sending')
    try {
      if (email.includes('error')) throw new Error('network')
      await sendOTP(email.trim())
      onSent(email.trim())
    } catch {
      setState('error_network')
    }
  }

  return (
    <div className="flex flex-col h-full px-8" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 flex flex-col justify-center">
        <h1 className="font-bold mb-2" style={{ fontSize: 28, color: '#1A1714', letterSpacing: '-0.02em' }}>
          What's your email?
        </h1>
        <p className="mb-8" style={{ color: '#9C9590', fontSize: 15 }}>
          {authMode() === 'supabase'
            ? 'We’ll email you a one-time code. No password needed.'
            : 'Dev mode: any 6-digit code works (except 000000).'}
        </p>

        <div className="relative">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setState('idle') }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            className="w-full py-4 px-4 rounded-2xl text-base outline-none transition-all"
            style={{
              background: '#F2EFE9',
              color: '#1A1714',
              border: state === 'error_network' ? '1.5px solid #C44040' : '1.5px solid transparent',
              caretColor: '#C4622D',
            }}
            autoFocus
          />
        </div>

        {state === 'error_network' && (
          <div className="flex items-center gap-2 mt-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C44040" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-sm" style={{ color: '#C44040' }}>Something went wrong. Check your connection and try again.</p>
          </div>
        )}
      </div>

      <div className="pb-12">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-lg transition-all active:scale-95 flex items-center justify-center gap-2"
          style={{
            background: valid && state !== 'sending' ? '#C4622D' : '#E4E0D9',
            color: valid && state !== 'sending' ? '#fff' : '#B0AAA4',
            cursor: valid && state !== 'sending' ? 'pointer' : 'default',
          }}
          onClick={handleSubmit}
          disabled={!valid || state === 'sending'}
        >
          {state === 'sending' ? (
            <>
              <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Sending code…
            </>
          ) : 'Send code'}
        </button>
      </div>
    </div>
  )
}

type OTPState = 'idle' | 'verifying' | 'invalid' | 'expired' | 'error_network' | 'resending'

const OTP_LEN = authMode() === 'supabase' ? 8 : 6

function OTPScreen({
  email,
  onVerified,
  onBack,
}: {
  email: string
  onVerified: () => void | Promise<void>
  onBack: () => void
}) {
  const [digits, setDigits] = useState(() => Array(OTP_LEN).fill(''))
  const [state, setState] = useState<OTPState>('idle')
  const [resendCountdown, setResendCountdown] = useState(30)
  const refs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (resendCountdown <= 0) return
    const t = setTimeout(() => setResendCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCountdown])

  const code = digits.join('')
  const complete = code.length === OTP_LEN

  useEffect(() => {
    if (complete) verify(code)
  }, [complete, code])

  function blankDigits() {
    return Array(OTP_LEN).fill('')
  }

  async function verify(token: string) {
    setState('verifying')
    try {
      const result = await verifyOTP(email, token)
      if (result.expired) { setState('expired'); setDigits(blankDigits()); refs.current[0]?.focus(); return }
      if (!result.valid) { setState('invalid'); setDigits(blankDigits()); refs.current[0]?.focus(); return }
      await onVerified()
    } catch {
      setState('error_network')
    }
  }

  async function resend() {
    if (resendCountdown > 0 || state === 'resending') return
    setState('resending')
    setDigits(blankDigits())
    try {
      await sendOTP(email)
      setResendCountdown(30)
      setState('idle')
      refs.current[0]?.focus()
    } catch {
      setState('error_network')
    }
  }

  function handleInput(i: number, val: string) {
    const char = val.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = char
    setDigits(next)
    setState('idle')
    if (char && i < OTP_LEN - 1) refs.current[i + 1]?.focus()
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus()
      const next = [...digits]; next[i - 1] = ''; setDigits(next)
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LEN)
    const next = pasted.split('').concat(Array(OTP_LEN).fill('')).slice(0, OTP_LEN)
    setDigits(next)
    const firstEmpty = next.findIndex(d => !d)
    refs.current[firstEmpty === -1 ? OTP_LEN - 1 : firstEmpty]?.focus()
  }

  const hasError = state === 'invalid' || state === 'expired' || state === 'error_network'
  const errorMsg =
    state === 'invalid' ? "That code isn't right. Please try again." :
    state === 'expired' ? 'That code has expired. Tap "Resend" to get a new one.' :
    state === 'error_network' ? 'Connection issue. Please check your network.' : ''

  return (
    <div className="flex flex-col h-full px-8" style={{ background: '#FAF8F5' }}>
      <div className="pt-14 mb-10 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: '#F2EFE9' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A1714" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
      </div>

      <div className="flex-1">
        <h1 className="font-bold mb-2" style={{ fontSize: 28, color: '#1A1714', letterSpacing: '-0.02em' }}>
          Check your email
        </h1>
        <p className="mb-8" style={{ color: '#9C9590', fontSize: 15 }}>
          {authMode() === 'supabase' ? (
            <>
              We emailed{' '}<span className="font-medium" style={{ color: '#1A1714' }}>{email}</span>
              . Enter the {OTP_LEN}-digit code, or open the confirmation link in that email.
            </>
          ) : (
            <>Dev mode — enter any {OTP_LEN}-digit code for{' '}<span className="font-medium" style={{ color: '#1A1714' }}>{email}</span></>
          )}
        </p>

        <div
          className="mb-4"
          onPaste={handlePaste}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${OTP_LEN}, minmax(0, 1fr))`,
            gap: 6,
            width: '100%',
            maxWidth: '100%',
          }}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { refs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              autoFocus={i === 0}
              onChange={e => handleInput(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="h-12 sm:h-14 rounded-xl text-center text-lg sm:text-xl font-bold outline-none transition-all"
              style={{
                width: '100%',
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box',
                padding: 0,
                background: hasError ? '#FDF0F0' : d ? '#F5E8DF' : '#F2EFE9',
                color: hasError ? '#C44040' : '#1A1714',
                border: hasError ? '1.5px solid #C44040' : d ? '1.5px solid #C4622D' : '1.5px solid transparent',
                caretColor: '#C4622D',
              }}
              disabled={state === 'verifying'}
            />
          ))}
        </div>

        {state === 'verifying' && (
          <div className="flex items-center gap-2 mt-2">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C9590" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <p className="text-sm" style={{ color: '#9C9590' }}>Verifying…</p>
          </div>
        )}

        {hasError && (
          <div className="flex items-start gap-2 mt-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C44040" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-sm" style={{ color: '#C44040' }}>{errorMsg}</p>
          </div>
        )}

        <div className="mt-6">
          {resendCountdown > 0 ? (
            <p className="text-sm" style={{ color: '#C8C4BE' }}>
              Resend code in <span className="font-medium tabular-nums" style={{ color: '#9C9590' }}>{resendCountdown}s</span>
            </p>
          ) : (
            <button
              className="text-sm font-semibold transition-all active:scale-95"
              style={{ color: state === 'resending' ? '#C8C4BE' : '#C4622D' }}
              onClick={resend}
              disabled={state === 'resending'}
            >
              {state === 'resending' ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type Gender = 'man' | 'woman' | 'nonbinary' | 'prefer_not'

function ProfileSetupScreen({ onDone }: { onDone: (profile: { name: string; age: string; gender: Gender }) => void }) {
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState<Gender | null>(null)

  const valid = name.trim().length >= 2 && Number(age) >= 18 && Number(age) <= 99 && gender !== null

  const genderOptions: { val: Gender; label: string }[] = [
    { val: 'man', label: 'Man' },
    { val: 'woman', label: 'Woman' },
    { val: 'nonbinary', label: 'Non-binary' },
    { val: 'prefer_not', label: 'Prefer not to say' },
  ]

  return (
    <div className="flex flex-col h-full px-8" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 overflow-y-auto pt-14">
        <h1 className="font-bold mb-2" style={{ fontSize: 28, color: '#1A1714', letterSpacing: '-0.02em' }}>
          A little about you
        </h1>
        <p className="mb-8" style={{ color: '#9C9590', fontSize: 15 }}>
          This helps us make better matches. It's only shared as a first name.
        </p>

        <div className="flex flex-col gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9C9590' }}>First name</label>
            <input
              type="text"
              placeholder="Gautam"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full py-4 px-4 rounded-2xl text-base outline-none"
              style={{ background: '#F2EFE9', color: '#1A1714', border: '1.5px solid transparent', caretColor: '#C4622D' }}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9C9590' }}>Age</label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="25"
              min={18}
              max={99}
              value={age}
              onChange={e => setAge(e.target.value)}
              className="w-full py-4 px-4 rounded-2xl text-base outline-none"
              style={{ background: '#F2EFE9', color: '#1A1714', border: '1.5px solid transparent', caretColor: '#C4622D' }}
            />
            {age && (Number(age) < 18) && (
              <p className="text-xs mt-1.5" style={{ color: '#C44040' }}>You must be 18 or older to use this app.</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9C9590' }}>I am a</label>
            <div className="grid grid-cols-2 gap-2">
              {genderOptions.map(opt => (
                <button
                  key={opt.val}
                  className="py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-95"
                  style={{
                    background: gender === opt.val ? '#C4622D' : '#F2EFE9',
                    color: gender === opt.val ? '#fff' : '#1A1714',
                    gridColumn: opt.val === 'prefer_not' ? 'span 2' : undefined,
                  }}
                  onClick={() => setGender(opt.val)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="pb-12 pt-6">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-lg transition-all active:scale-95"
          style={{
            background: valid ? '#C4622D' : '#E4E0D9',
            color: valid ? '#fff' : '#B0AAA4',
            cursor: valid ? 'pointer' : 'default',
          }}
          onClick={async () => {
            if (!valid) return
            try {
              await updateProfile(name.trim())
            } catch {
              /* profile sync optional if offline */
            }
            onDone({ name: name.trim(), age, gender: gender! })
          }}
          disabled={!valid}
        >
          Start talking
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

type Screen =
  | 'welcome'
  | 'auth_email'
  | 'auth_otp'
  | 'auth_profile'
  | 'onboarding'
  | 'home'
  | 'duration'
  | 'finding'
  | 'found'
  | 'call'
  | 'ending'
  | 'rate'
  | 'talkagain'
  | 'people'
  | 'person'
  | 'profile'
  | 'microphone'

type Tab = 'home' | 'people' | 'profile'

type Person = {
  id: string
  name: string
  initials: string
  color: string
  descriptor: string
  online?: boolean
  busy?: boolean
  status?: string
}

const COLORS = ['#C4622D', '#4A7FA5', '#4A9B6F', '#8B6BB5', '#C47A2D']

function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * 17) % COLORS.length
  return COLORS[h]
}

function isBusyStatus(status?: string, busy?: boolean) {
  if (busy) return true
  return status === 'BUSY' || status === 'CONNECTING' || status === 'RESERVED'
}

function presenceLabel(p: { online?: boolean; busy?: boolean; status?: string; descriptor?: string }) {
  if (isBusyStatus(p.status, p.busy)) return 'On a call'
  if (p.online || p.status === 'AVAILABLE') return 'Available now'
  return p.descriptor || 'Offline'
}

function toPerson(p: PersonDTO, i = 0): Person {
  const name = p.display_name || 'Someone'
  const busy = isBusyStatus(p.status, p.busy)
  const online = !!p.online && !busy
  return {
    id: p.id,
    name,
    initials: p.initials || name.slice(0, 1).toUpperCase(),
    color: p.color || colorFor(p.id || String(i)),
    descriptor: presenceLabel({ ...p, online, busy }),
    online,
    busy,
    status: p.status,
  }
}

const TAGS = ['Great listener', 'Easy to talk to', 'Made me smile', 'Interesting', 'Helpful', 'Felt natural']

function Avatar({ initials, color, size = 64 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  )
}

function BottomNav({ tab, setTab, setScreen }: { tab: Tab; setTab: (t: Tab) => void; setScreen: (s: Screen) => void }) {
  return (
    <div className="border-t flex" style={{ borderColor: '#E4E0D9', background: '#FAF8F5', paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
      {(['home', 'people', 'profile'] as Tab[]).map(t => {
        const active = tab === t
        const icons: Record<Tab, ReactElement> = {
          home: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
              <path d="M9 21V12h6v9" />
            </svg>
          ),
          people: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="7" r="4" />
              <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
              <path d="M16 3.13a4 4 0 010 7.75" />
              <path d="M21 21v-2a4 4 0 00-3-3.87" />
            </svg>
          ),
          profile: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          ),
        }
        return (
          <button
            key={t}
            className="flex-1 flex flex-col items-center gap-1 pt-3 pb-1 transition-colors"
            style={{ color: active ? '#C4622D' : '#9C9590' }}
            onClick={() => { setTab(t); setScreen(t as Screen) }}
          >
            {icons[t]}
            <span className="text-xs font-medium capitalize">{t}</span>
          </button>
        )
      })}
    </div>
  )
}

function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  // Welcome already covers the “want someone to talk to” pitch — don’t repeat it here.
  const slides = [
    { headline: 'Real people.', sub: 'Real conversations.' },
    { headline: 'Find someone in seconds.', sub: '' },
    { headline: 'Talk as long as you like.', sub: 'No feed. No followers. Just a conversation.' },
  ]
  const s = slides[step]
  const isLast = step === slides.length - 1

  return (
    <div className="flex flex-col h-full" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 flex flex-col justify-center px-8">
        <div className="mb-6 flex gap-1.5">
          {slides.map((_, i) => (
            <div key={i} className="h-0.5 flex-1 rounded-full transition-all duration-300"
              style={{ background: i <= step ? '#C4622D' : '#E4E0D9' }} />
          ))}
        </div>
        <div className="animate-fade-up" key={step}>
          <p className="font-bold leading-tight mb-3" style={{ fontSize: 32, color: '#1A1714', letterSpacing: '-0.02em' }}>
            {s.headline}
          </p>
          {s.sub && <p className="text-lg font-medium" style={{ color: '#9C9590' }}>{s.sub}</p>}
        </div>
      </div>
      <div className="px-6 pb-10">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg transition-all active:scale-95"
          style={{ background: '#C4622D' }}
          onClick={() => isLast ? onDone() : setStep(s => s + 1)}
        >
          {isLast ? 'Start talking' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

function MicrophoneScreen({ onAllow }: { onAllow: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function requestMic() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const stream = await getMicrophoneStream()
      stream.getTracks().forEach((t) => t.stop())
      onAllow()
    } catch (e) {
      if (e instanceof MicPermissionError) {
        setError(e.message)
      } else {
        setError('Could not access the microphone.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full items-center justify-center px-8 text-center" style={{ background: '#FAF8F5' }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-8" style={{ background: '#F5E8DF' }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#C4622D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0014 0" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
      </div>
      <h1 className="font-bold mb-3" style={{ fontSize: 26, color: '#1A1714', letterSpacing: '-0.02em' }}>
        Your microphone lets you talk.
      </h1>
      <p className="mb-6 leading-relaxed" style={{ color: '#9C9590', fontSize: 16 }}>
        We need microphone access for live audio. We never record or store your calls.
      </p>
      {error && (
        <p className="mb-4 text-sm px-3 py-2 rounded-xl" style={{ background: '#FDF0F0', color: '#C44040' }}>{error}</p>
      )}
      <button
        className="w-full py-4 rounded-2xl font-semibold text-white text-base transition-all active:scale-95"
        style={{ background: '#C4622D', opacity: busy ? 0.7 : 1 }}
        disabled={busy}
        onClick={() => void requestMic()}
      >
        {busy ? 'Checking…' : error ? 'Try again' : 'Allow microphone'}
      </button>
      {error && (
        <p className="mt-4 text-xs" style={{ color: '#9C9590' }}>
          On iPhone/Android: use Safari/Chrome → site settings → allow Microphone.
        </p>
      )}
    </div>
  )
}

function HomeScreen({
  onTalkNow,
  onTalkPerson,
  setTab,
  setScreen,
  userName,
}: {
  onTalkNow: () => void
  onTalkPerson: (person: Person) => void
  setTab: (t: Tab) => void
  setScreen: (s: Screen) => void
  userName: string
}) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const [available, setAvailable] = useState<Person[]>([])
  const [busyPeople, setBusyPeople] = useState<Person[]>([])
  const [recent, setRecent] = useState<Person[]>([])
  const [availableCount, setAvailableCount] = useState(0)
  const [busyCount, setBusyCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [avail, favs, calls] = await Promise.all([
          fetchAvailableListeners(),
          fetchFavorites().catch(() => ({ favorites: [] })),
          fetchCalls().catch(() => ({ calls: [] })),
        ])
        if (!alive) return
        const people = (avail.listeners || []).map((p, i) => toPerson(p, i))
        const free = people.filter(p => !p.busy)
        const onCall = people.filter(p => p.busy)
        setAvailable(free)
        setBusyPeople(onCall)
        setAvailableCount(avail.count ?? free.length)
        setBusyCount(avail.busy ?? onCall.length)

        const byId = new Map(people.map(p => [p.id, p]))
        const fromFavs = (favs.favorites || []).map((f, i) => {
          const live = byId.get(f.listener_id)
          return toPerson({
            id: f.listener_id,
            display_name: f.display_name || live?.name || 'Someone',
            initials: (f.display_name || live?.name || 'S').slice(0, 1).toUpperCase(),
            online: live?.online,
            busy: live?.busy,
            status: live?.status,
            descriptor: 'Favorite',
          }, i)
        })
        const seen = new Set(fromFavs.map(p => p.id))
        const fromCalls: Person[] = []
        for (const c of calls.calls || []) {
          if (!c.listener_id || seen.has(c.listener_id)) continue
          seen.add(c.listener_id)
          const live = byId.get(c.listener_id)
          fromCalls.push(
            toPerson({
              id: c.listener_id,
              display_name: c.other_name || live?.name || 'Someone',
              initials: (c.other_name || live?.name || 'S').slice(0, 1).toUpperCase(),
              online: live?.online,
              busy: live?.busy,
              status: live?.status,
              descriptor: c.billable_seconds
                ? `${Math.ceil(c.billable_seconds / 60)} min talk`
                : c.status,
            }),
          )
        }
        setRecent([...fromFavs, ...fromCalls].slice(0, 5))
      } catch (e) {
        console.error(e)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <div className="flex flex-col h-full" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <p className="text-sm font-medium mb-1" style={{ color: '#9C9590' }}>{greeting}, {userName}</p>
        <h1 className="font-bold leading-none mb-2" style={{ fontSize: 40, color: '#1A1714', letterSpacing: '-0.03em' }}>
          Want to talk?
        </h1>
        <p className="mb-10" style={{ color: '#9C9590', fontSize: 16 }}>
          Connect with someone who's ready to listen.
        </p>

        <button
          className="w-full py-5 rounded-3xl font-semibold text-white text-xl transition-all active:scale-95 mb-4"
          style={{ background: '#C4622D', boxShadow: '0 4px 24px rgba(196,98,45,0.28)' }}
          onClick={onTalkNow}
        >
          Talk now
        </button>

        <div className="flex items-center gap-2 justify-center mb-10">
          <div className="w-2 h-2 rounded-full" style={{ background: availableCount > 0 ? '#4A9B6F' : busyCount > 0 ? '#C47A2D' : '#D8D4CE' }} />
          <p className="text-sm font-medium" style={{ color: availableCount > 0 ? '#4A9B6F' : '#9C9590' }}>
            {loading
              ? 'Checking who’s online…'
              : availableCount > 0
                ? `${availableCount} available now${busyCount > 0 ? ` · ${busyCount} on a call` : ''}`
                : busyCount > 0
                  ? `${busyCount} on a call — none free right now`
                  : 'No one online — open Profile on another device and go Available'}
          </p>
          {(available.length > 0 || busyPeople.length > 0) && (
            <div className="flex -space-x-1.5 ml-1">
              {[...available, ...busyPeople].slice(0, 4).map(p => (
                <div key={p.id} className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-white font-semibold relative"
                  style={{ background: p.color, borderColor: '#FAF8F5', fontSize: 9, opacity: p.busy ? 0.55 : 1 }}>
                  {p.initials}
                </div>
              ))}
            </div>
          )}
        </div>

        {available.length > 0 && (
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9C9590' }}>Available now</p>
            <div className="flex flex-col gap-3">
              {available.map(person => (
                <div key={person.id} className="flex items-center gap-4 py-4 px-4 rounded-2xl" style={{ background: '#F2EFE9' }}>
                  <Avatar initials={person.initials} color={person.color} size={44} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" style={{ color: '#1A1714' }}>{person.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#4A9B6F' }}>Available now</p>
                  </div>
                  <button
                    className="text-sm font-semibold px-4 py-2 rounded-xl"
                    style={{ color: '#C4622D', background: '#F5E8DF' }}
                    onClick={() => onTalkPerson(person)}
                  >
                    Talk
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {busyPeople.length > 0 && (
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9C9590' }}>On a call</p>
            <div className="flex flex-col gap-3">
              {busyPeople.map(person => (
                <div key={person.id} className="flex items-center gap-4 py-4 px-4 rounded-2xl" style={{ background: '#F2EFE9' }}>
                  <div className="relative">
                    <Avatar initials={person.initials} color={person.color} size={44} />
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                      style={{ background: '#C47A2D', borderColor: '#F2EFE9' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" style={{ color: '#1A1714' }}>{person.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#C47A2D' }}>On a call</p>
                  </div>
                  <span className="text-sm font-medium px-4 py-2 rounded-xl flex-shrink-0"
                    style={{ color: '#9C9590', background: '#EBE7E1' }}>
                    Busy
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9C9590' }}>Talk again</p>
          <div className="flex flex-col gap-3">
            {recent.length === 0 && !loading && (
              <p className="text-sm" style={{ color: '#9C9590' }}>
                After a good call, people you like will show up here.
              </p>
            )}
            {recent.map(person => (
              <div key={person.id} className="flex items-center gap-4 py-4 px-4 rounded-2xl"
                style={{ background: '#F2EFE9' }}>
                <Avatar initials={person.initials} color={person.color} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: '#1A1714' }}>{person.name}</p>
                  <p className="text-xs mt-0.5" style={{
                    color: person.busy ? '#C47A2D' : person.online ? '#4A9B6F' : '#9C9590',
                  }}>
                    {presenceLabel(person)}
                  </p>
                </div>
                {person.busy ? (
                  <span className="text-sm font-medium px-4 py-2 rounded-xl" style={{ color: '#9C9590', background: '#EBE7E1' }}>
                    Busy
                  </span>
                ) : (
                  <button
                    className="text-sm font-semibold px-4 py-2 rounded-xl transition-all active:scale-95"
                    style={{ color: '#C4622D', background: '#F5E8DF' }}
                    onClick={() => onTalkPerson(person)}
                  >
                    Talk
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomNav tab="home" setTab={setTab} setScreen={setScreen} />
    </div>
  )
}

function DurationScreen({ onNext, onBack }: { onNext: (d: number) => void; onBack: () => void }) {
  const [selected, setSelected] = useState(10)
  const options = [10, 20, 30]

  return (
    <div className="flex flex-col h-full px-6" style={{ background: '#FAF8F5' }}>
      <div className="flex items-center pt-14 mb-12">
        <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center mr-4"
          style={{ background: '#F2EFE9' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1714" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div>
          <h1 className="font-bold leading-tight" style={{ fontSize: 26, color: '#1A1714', letterSpacing: '-0.02em' }}>
            How long do you want to talk?
          </h1>
        </div>
      </div>

      <p className="mb-8 text-sm" style={{ color: '#9C9590' }}>Choose a time that feels right.</p>

      <div className="flex flex-col gap-3 mb-auto">
        {options.map(opt => {
          const active = selected === opt
          return (
            <button
              key={opt}
              className="w-full py-6 rounded-3xl flex items-center px-6 transition-all active:scale-98"
              style={{
                background: active ? '#C4622D' : '#F2EFE9',
                border: active ? 'none' : '1.5px solid #E4E0D9',
              }}
              onClick={() => setSelected(opt)}
            >
              <span className="font-bold text-4xl" style={{ color: active ? '#fff' : '#1A1714', letterSpacing: '-0.03em' }}>{opt}</span>
              <span className="font-medium ml-2 mt-1 text-lg" style={{ color: active ? 'rgba(255,255,255,0.7)' : '#9C9590' }}>min</span>
              {active && (
                <div className="ml-auto w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="pb-10 mt-8">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg transition-all active:scale-95 mb-3"
          style={{ background: '#C4622D' }}
          onClick={() => onNext(selected)}
        >
          Find someone
        </button>
        <p className="text-center text-xs" style={{ color: '#9C9590' }}>You can end the conversation anytime.</p>
      </div>
    </div>
  )
}

function FindingScreen({
  preferListenerId,
  onFound,
  onFailed,
}: {
  preferListenerId?: string
  onFound: (info: { callId: string; listenerId: string; name: string }) => void
  onFailed: (reason: string) => void
}) {
  const [phase, setPhase] = useState<'searching' | 'almost'>('searching')

  useEffect(() => {
    let unsub = () => {}
    let cancelled = false
    ;(async () => {
      try {
        await ensureCredits(100)
        if (cancelled) return
        await signaling.connect()
        if (cancelled) return
        unsub = signaling.onMessage((msg) => {
          if (cancelled) return
          if (msg.type === 'call.matched') {
            setPhase('almost')
            const lid = String(msg.listener_id || '')
            void (async () => {
              let name = 'Someone'
              try {
                const avail = await fetchAvailableListeners()
                const hit = (avail.listeners || []).find(l => l.id === lid)
                if (hit?.display_name) name = hit.display_name
              } catch { /* ignore */ }
              if (name === 'Someone' && lid) {
                try {
                  const favs = await fetchFavorites()
                  const f = (favs.favorites || []).find(x => x.listener_id === lid)
                  if (f?.display_name) name = f.display_name
                } catch { /* ignore */ }
              }
              setTimeout(() => {
                if (!cancelled) {
                  onFound({ callId: String(msg.call_id), listenerId: lid, name })
                }
              }, 800)
            })()
          }
          if (msg.type === 'call.failed') {
            onFailed(String(msg.reason || 'NO_LISTENER'))
          }
        })
        const payload: Record<string, unknown> = { type: 'call.request', duration: 0 }
        if (preferListenerId) payload.listener_id = preferListenerId
        signaling.send(payload)
      } catch (e) {
        if (cancelled) return
        const detail = e instanceof Error ? e.message : 'unknown'
        console.error('FindingScreen failed', e)
        onFailed(detail === 'not authenticated' ? 'NOT_AUTHENTICATED' : 'CONNECTION_ERROR')
      }
    })()
    return () => {
      cancelled = true
      unsub()
    }
  }, [preferListenerId])

  return (
    <div className="flex flex-col h-full items-center justify-center px-8 text-center" style={{ background: '#FAF8F5' }}>
      <div className="relative mb-10">
        <div className="absolute inset-0 rounded-full pulse-ring2"
          style={{ background: 'rgba(196,98,45,0.08)', margin: -24 }} />
        <div className="absolute inset-0 rounded-full pulse-ring"
          style={{ background: 'rgba(196,98,45,0.12)', margin: -12 }} />
        <div className="w-24 h-24 rounded-full flex items-center justify-center"
          style={{ background: '#F5E8DF' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C4622D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0118 0v6" />
            <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5z" />
            <path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z" />
          </svg>
        </div>
      </div>

      <h1 className="font-bold mb-3 transition-all duration-500" style={{ fontSize: 26, color: '#1A1714', letterSpacing: '-0.02em' }}>
        {phase === 'searching' ? 'Finding someone for you…' : 'Almost there…'}
      </h1>
      <p className="mb-8" style={{ color: '#9C9590', fontSize: 15 }}>
        {phase === 'searching'
          ? 'Looking for someone ready to talk.'
          : 'We found a great match.'}
      </p>

      <div className="flex gap-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full dot-bounce" style={{ background: '#C4622D' }} />
        ))}
      </div>
    </div>
  )
}

function FoundScreen({
  peerName,
  callId,
  onStart,
  onSkip,
  onTimeout,
}: {
  peerName: string
  callId: string
  onStart: () => void
  onSkip: () => void
  onTimeout: () => void
}) {
  const [accepted, setAccepted] = useState(() => !!signaling.getCallFlags(callId)?.accepted)
  const initials = peerName.slice(0, 1).toUpperCase() || 'S'

  useEffect(() => {
    if (signaling.getCallFlags(callId)?.accepted) setAccepted(true)
    const off = signaling.onMessage((msg) => {
      if (String(msg.call_id) !== callId) return
      if (msg.type === 'call.accepted') setAccepted(true)
      if (msg.type === 'call.state' && (
        msg.status === 'CALL_ACCEPTED' ||
        msg.status === 'WEBRTC_NEGOTIATING' ||
        msg.status === 'ACTIVE'
      )) {
        setAccepted(true)
      }
      if (msg.type === 'call.ended') onTimeout()
    })
    return () => { off() }
  }, [callId, onTimeout])

  useEffect(() => {
    if (!accepted) return
    const t = setTimeout(() => onStart(), 400)
    return () => clearTimeout(t)
  }, [accepted, onStart])

  return (
    <div className="flex flex-col h-full items-center justify-center px-6 text-center animate-fade-in" style={{ background: '#FAF8F5' }}>
      <p className="text-sm font-medium mb-6" style={{ color: '#9C9590' }}>Meet</p>

      <div className="relative mb-6">
        <Avatar initials={initials} color="#C4622D" size={96} />
        <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full border-2 flex items-center justify-center"
          style={{ background: '#F2EFE9', borderColor: '#FAF8F5' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4A9B6F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
      </div>

      <h1 className="font-bold mb-1" style={{ fontSize: 34, color: '#1A1714', letterSpacing: '-0.03em' }}>{peerName}</h1>
      <p className="mb-6" style={{ color: '#9C9590', fontSize: 15 }}>
        {accepted ? 'Talk as long as you like' : 'Waiting for them to accept…'}
      </p>

      <div className="flex flex-col gap-2 mb-10">
        {(accepted ? ['Verified', 'Ready to talk'] : ['Verified', 'Ringing…']).map(badge => (
          <div key={badge} className="flex items-center gap-2 justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={accepted ? '#4A9B6F' : '#C47A2D'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span className="text-sm" style={{ color: accepted ? '#4A9B6F' : '#C47A2D' }}>{badge}</span>
          </div>
        ))}
      </div>

      <div className="w-full flex flex-col gap-3">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg transition-all active:scale-95"
          style={{ background: accepted ? '#C4622D' : '#D8D4CE' }}
          disabled={!accepted}
          onClick={onStart}
        >
          {accepted ? 'Start talking' : 'Waiting for accept…'}
        </button>
        <button
          className="w-full py-4 rounded-2xl font-medium text-base transition-all active:scale-95"
          style={{ color: '#9C9590', background: '#F2EFE9' }}
          onClick={onSkip}
        >
          Find someone else
        </button>
      </div>
    </div>
  )
}

function CallScreen({
  callId,
  peerName,
  onEnd,
}: {
  callId: string
  peerName: string
  onEnd: (billableSeconds?: number) => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [speaker, setSpeaker] = useState(true)
  const [speaking, setSpeaking] = useState(true)
  const [status, setStatus] = useState('Connecting…')
  const [connState, setConnState] = useState<CallConnectionState>('idle')
  const [micError, setMicError] = useState('')
  const [needTapAudio, setNeedTapAudio] = useState(false)
  const sessionRef = useRef<BrowserAudioCall | null>(null)
  const startedRef = useRef(false)
  const endingRef = useRef(false)

  useEffect(() => {
    let unsub = () => {}
    let cancelled = false
    const startAsTalker = async () => {
      if (startedRef.current || cancelled) return
      startedRef.current = true
      setStatus('Starting audio…')
      setMicError('')
      const sess = new BrowserAudioCall(callId, true, {
        onState: (s) => {
          setConnState(s)
          if (s === 'connected') setStatus('Talking')
          else if (s === 'reconnecting') setStatus('Reconnecting…')
          else if (s === 'connecting') setStatus('Connecting…')
          else if (s === 'mic-denied') setStatus('Microphone blocked')
          else if (s === 'failed') setStatus('Connection failed')
        },
        onNeedGesture: () => setNeedTapAudio(true),
      })
      sessionRef.current = sess
      try {
        await sess.start()
      } catch (e) {
        startedRef.current = false
        const msg = e instanceof MicPermissionError ? e.message : 'Microphone permission needed'
        setMicError(msg)
        setStatus('Microphone blocked')
        signaling.send({ type: 'call.end', call_id: callId, reason: 'MIC_DENIED' })
      }
    }

    ;(async () => {
      await signaling.connect()
      if (cancelled) return
      const flags = signaling.getCallFlags(callId)
      if (flags?.accepted || flags?.status === 'WEBRTC_NEGOTIATING' || flags?.status === 'ACTIVE') {
        await startAsTalker()
      }
      unsub = signaling.onMessage(async (msg) => {
        if (String(msg.call_id) !== callId && msg.call_id != null) return
        if (msg.type === 'call.accepted' || (msg.type === 'call.state' && (
          msg.status === 'CALL_ACCEPTED' ||
          msg.status === 'WEBRTC_NEGOTIATING' ||
          msg.status === 'WEBRTC_CONNECTED' ||
          msg.status === 'ACTIVE'
        ))) {
          await startAsTalker()
        }
        if (msg.type === 'call.state' && msg.status === 'ACTIVE') {
          setStatus('Talking')
        }
        if (msg.type === 'webrtc.answer' || msg.type === 'webrtc.ice' || msg.type === 'webrtc.offer') {
          await sessionRef.current?.handleRemote(msg)
        }
        if (msg.type === 'call.ended') {
          if (endingRef.current) return
          endingRef.current = true
          await sessionRef.current?.stop()
          onEnd(Number(msg.billable_seconds) || undefined)
        }
      })
      setTimeout(() => {
        if (!startedRef.current && !cancelled) {
          setStatus('Waiting for them to join…')
        }
      }, 500)
    })()

    return () => {
      cancelled = true
      unsub()
      sessionRef.current?.stop()
    }
  }, [callId])

  useEffect(() => {
    if (status !== 'Talking' && status !== 'Reconnecting…') return
    const t = setInterval(() => {
      setElapsed((s) => s + 1)
      setSpeaking((s) => (Math.random() > 0.2 ? s : !s))
    }, 1000)
    return () => clearInterval(t)
  }, [status])

  async function retryMic() {
    setMicError('')
    startedRef.current = false
    await sessionRef.current?.stop()
    sessionRef.current = null
    const flags = signaling.getCallFlags(callId)
    if (flags?.accepted || flags?.status) {
      // remount start path
      startedRef.current = false
      setStatus('Starting audio…')
      const sess = new BrowserAudioCall(callId, true, {
        onState: (s) => {
          setConnState(s)
          if (s === 'connected') setStatus('Talking')
          else if (s === 'reconnecting') setStatus('Reconnecting…')
        },
        onNeedGesture: () => setNeedTapAudio(true),
      })
      sessionRef.current = sess
      startedRef.current = true
      try {
        await sess.start()
      } catch (e) {
        startedRef.current = false
        setMicError(e instanceof MicPermissionError ? e.message : 'Microphone permission needed')
      }
    }
  }

  function hangUp() {
    if (endingRef.current) return
    endingRef.current = true
    signaling.send({ type: 'call.end', call_id: callId })
    void sessionRef.current?.stop()
  }

  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const secs = String(elapsed % 60).padStart(2, '0')
  const initials = peerName.slice(0, 1).toUpperCase() || 'S'
  const live = status === 'Talking' || status === 'Reconnecting…'

  return (
    <div className="flex flex-col h-full" style={{ background: '#1A1714' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full" style={{
            background: 'radial-gradient(circle, rgba(196,98,45,0.15) 0%, transparent 70%)',
            transform: 'scale(2.2)',
          }} />
          {speaking && status === 'Talking' && (
            <>
              <div className="absolute inset-0 rounded-full pulse-ring" style={{ background: 'rgba(196,98,45,0.12)', margin: -16 }} />
              <div className="absolute inset-0 rounded-full pulse-ring2" style={{ background: 'rgba(196,98,45,0.07)', margin: -28 }} />
            </>
          )}
          <Avatar initials={initials} color="#C4622D" size={112} />
        </div>

        <h2 className="font-semibold mb-1" style={{ fontSize: 22, color: '#F0EDE8' }}>{peerName}</h2>
        <p className="text-sm mb-2" style={{ color: status === 'Reconnecting…' ? '#C47A2D' : 'rgba(240,237,232,0.5)' }}>
          {status}
        </p>

        {micError && (
          <div className="w-full mb-4 px-4 py-3 rounded-2xl text-sm text-center" style={{ background: 'rgba(196,68,64,0.2)', color: '#F5C4C2' }}>
            {micError}
            <button className="block mx-auto mt-2 font-semibold underline" onClick={() => void retryMic()}>
              Allow mic & retry
            </button>
          </div>
        )}

        {needTapAudio && (
          <button
            className="mb-4 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: '#F5E8DF', color: '#C4622D' }}
            onClick={() => {
              void sessionRef.current?.unlockAudio()
              setNeedTapAudio(false)
            }}
          >
            Tap to hear them
          </button>
        )}

        {speaking && status === 'Talking' && (
          <div className="flex items-end gap-1 h-5 mb-4">
            {[3, 6, 9, 6, 3].map((h, i) => (
              <div key={i} className="w-1 rounded-full wave-bar"
                style={{ background: '#C4622D', height: h * 1.6, maxHeight: 20, minHeight: 4 }} />
            ))}
          </div>
        )}

        <p className="font-bold tabular-nums" style={{ fontSize: 56, color: '#F0EDE8', letterSpacing: '-0.04em' }}>
          {mins}:{secs}
        </p>
        <p className="text-xs mt-1" style={{ color: 'rgba(240,237,232,0.4)' }}>
          {connState === 'reconnecting' ? 'Trying TURN / ICE again…' : live ? 'Live connection' : 'Connecting…'}
        </p>
      </div>

      <div className="px-8 pb-14">
        <div className="flex items-center justify-between">
          <button
            className="w-16 h-16 rounded-full flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
            style={{ background: muted ? 'rgba(196,98,45,0.2)' : 'rgba(240,237,232,0.1)' }}
            onClick={() => {
              const next = !muted
              setMuted(next)
              sessionRef.current?.setMuted(next)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={muted ? '#C4622D' : '#F0EDE8'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {muted ? (
                <>
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                  <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23" />
                  <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                </>
              ) : (
                <>
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                </>
              )}
            </svg>
          </button>

          <button
            className="w-20 h-20 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: '#C44040' }}
            onClick={hangUp}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
              <path d="M10.68 13.31a16 16 0 006.01 6.01l2.02-2.02a1 1 0 011.01-.24c1.12.37 2.33.57 3.28.57a1 1 0 011 1V21a1 1 0 01-1 1C10.07 22 2 13.93 2 3a1 1 0 011-1h3.5a1 1 0 011 1c0 .95.2 2.16.57 3.28a1 1 0 01-.24 1.01l-2.02 2.02" transform="rotate(135 12 12)" />
            </svg>
          </button>

          <button
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: speaker ? 'rgba(240,237,232,0.1)' : 'rgba(196,98,45,0.2)' }}
            onClick={() => {
              setSpeaker(!speaker)
              void sessionRef.current?.unlockAudio()
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F0EDE8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function EndingScreen() {
  return (
    <div className="flex flex-col h-full items-center justify-center px-8 text-center" style={{ background: '#FAF8F5' }}>
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ background: '#F2EFE9' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9C9590" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <h1 className="font-semibold" style={{ fontSize: 22, color: '#1A1714' }}>Conversation ended</h1>
    </div>
  )
}

function RateScreen({
  callId,
  listenerId,
  peerName,
  onDone,
}: {
  callId?: string
  listenerId?: string
  peerName: string
  onDone: () => void
}) {
  const [stars, setStars] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [talkAgain, setTalkAgain] = useState<boolean | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const toggleTag = (t: string) => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  const initials = peerName.slice(0, 1).toUpperCase() || 'S'

  return (
    <div className="flex flex-col h-full" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <div className="flex items-center gap-3 mb-8">
          <Avatar initials={initials} color="#C4622D" size={48} />
          <div>
            <h1 className="font-bold" style={{ fontSize: 22, color: '#1A1714', letterSpacing: '-0.02em' }}>How was it?</h1>
            <p className="text-sm" style={{ color: '#9C9590' }}>Your conversation with {peerName}</p>
          </div>
        </div>

        <div className="flex gap-2 mb-8 justify-center">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              className="transition-all active:scale-90"
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setStars(n)}
            >
              <svg width="40" height="40" viewBox="0 0 24 24"
                fill={n <= (hovered || stars) ? '#C4622D' : 'none'}
                stroke={n <= (hovered || stars) ? '#C4622D' : '#D8D4CE'}
                strokeWidth="1.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          ))}
        </div>

        <p className="font-semibold text-sm mb-3" style={{ color: '#1A1714' }}>Would you talk to {peerName} again?</p>
        <div className="flex gap-3 mb-8">
          {[{ label: 'Yes, definitely', val: true }, { label: 'Maybe later', val: false }].map(opt => (
            <button
              key={opt.label}
              className="flex-1 py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-95"
              style={{
                background: talkAgain === opt.val ? '#C4622D' : '#F2EFE9',
                color: talkAgain === opt.val ? '#fff' : '#1A1714',
              }}
              onClick={() => setTalkAgain(opt.val)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <p className="font-semibold text-sm mb-3" style={{ color: '#1A1714' }}>What stood out?</p>
        <div className="flex flex-wrap gap-2 mb-8">
          {TAGS.map(tag => {
            const active = tags.includes(tag)
            return (
              <button
                key={tag}
                className="px-4 py-2 rounded-full text-sm font-medium transition-all active:scale-95"
                style={{
                  background: active ? '#C4622D' : '#F2EFE9',
                  color: active ? '#fff' : '#9C9590',
                }}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            )
          })}
        </div>

        <p className="font-semibold text-sm mb-2" style={{ color: '#1A1714' }}>Anything to remember? <span style={{ color: '#9C9590', fontWeight: 400 }}>(optional)</span></p>
        <textarea
          className="w-full rounded-2xl px-4 py-3 text-sm resize-none mb-8 outline-none"
          rows={3}
          placeholder="A private note just for you…"
          value={note}
          onChange={e => setNote(e.target.value)}
          style={{ background: '#F2EFE9', color: '#1A1714', border: '1.5px solid #E4E0D9' }}
        />
      </div>

      <div className="px-6 pb-10">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg transition-all active:scale-95"
          style={{ background: '#C4622D', opacity: saving ? 0.7 : 1 }}
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              if (callId && listenerId && stars > 0) {
                await submitRating({
                  callId,
                  listenerId,
                  rating: stars,
                  favorite: talkAgain === true,
                  tags,
                })
              }
            } catch {
              /* rating optional if offline */
            }
            onDone()
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}

function TalkAgainScreen({
  peerName,
  onTalkAgain,
  onLater,
}: {
  peerName: string
  onTalkAgain: () => void
  onLater: () => void
}) {
  const initials = peerName.slice(0, 1).toUpperCase() || 'S'
  return (
    <div className="flex flex-col h-full items-center justify-center px-6 text-center animate-fade-in" style={{ background: '#FAF8F5' }}>
      <p className="text-sm font-medium mb-8" style={{ color: '#9C9590' }}>Good conversations are worth keeping.</p>

      <Avatar initials={initials} color={colorFor(peerName)} size={88} />
      <h1 className="font-bold mt-5 mb-1" style={{ fontSize: 30, color: '#1A1714', letterSpacing: '-0.02em' }}>{peerName}</h1>
      <p className="mb-10 text-sm" style={{ color: '#9C9590' }}>Great conversation</p>

      <div className="w-full flex flex-col gap-3">
        <button
          className="w-full py-4 rounded-2xl font-semibold text-white text-lg transition-all active:scale-95"
          style={{ background: '#C4622D' }}
          onClick={onTalkAgain}
        >
          Talk again
        </button>
        <button
          className="w-full py-4 rounded-2xl font-medium text-base transition-all active:scale-95"
          style={{ color: '#9C9590', background: '#F2EFE9' }}
          onClick={onLater}
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}

function PeopleScreen({
  setTab,
  setScreen,
  onPersonTap,
  onTalk,
}: {
  setTab: (t: Tab) => void
  setScreen: (s: Screen) => void
  onPersonTap: (p: Person) => void
  onTalk: (p: Person) => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [available, setAvailable] = useState<Person[]>([])
  const [busyPeople, setBusyPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [avail, favs, calls] = await Promise.all([
          fetchAvailableListeners(),
          fetchFavorites().catch(() => ({ favorites: [] })),
          fetchCalls().catch(() => ({ calls: [] })),
        ])
        if (!alive) return
        const live = (avail.listeners || []).map((p, i) => toPerson(p, i))
        setAvailable(live.filter(p => !p.busy))
        setBusyPeople(live.filter(p => p.busy))
        const byId = new Map(live.map(p => [p.id, p]))
        const map = new Map<string, Person>()
        for (const f of favs.favorites || []) {
          const hit = byId.get(f.listener_id)
          map.set(f.listener_id, toPerson({
            id: f.listener_id,
            display_name: f.display_name || hit?.name || 'Someone',
            initials: (f.display_name || hit?.name || 'S').slice(0, 1).toUpperCase(),
            online: hit?.online,
            busy: hit?.busy,
            status: hit?.status,
            descriptor: 'Favorite',
          }))
        }
        for (const c of calls.calls || []) {
          if (!c.listener_id || map.has(c.listener_id)) continue
          const hit = byId.get(c.listener_id)
          map.set(c.listener_id, toPerson({
            id: c.listener_id,
            display_name: c.other_name || hit?.name || 'Someone',
            initials: (c.other_name || hit?.name || 'S').slice(0, 1).toUpperCase(),
            online: hit?.online,
            busy: hit?.busy,
            status: hit?.status,
            descriptor: c.billable_seconds ? `${Math.ceil(c.billable_seconds / 60)} min` : 'Past call',
          }))
        }
        setPeople([...map.values()])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const talkOrBusy = (person: Person, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation()
    if (person.busy) return
    onTalk(person)
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <h1 className="font-bold mb-1" style={{ fontSize: 30, color: '#1A1714', letterSpacing: '-0.02em' }}>People</h1>
        <p className="text-sm mb-8" style={{ color: '#9C9590' }}>People online and people you've talked to.</p>

        {available.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9C9590' }}>Available now</p>
            <div className="flex flex-col gap-3 mb-8">
              {available.map(person => (
                <div key={person.id} className="flex items-center gap-4 py-4 px-4 rounded-2xl" style={{ background: '#F2EFE9' }}
                  onClick={() => onPersonTap(person)}>
                  <Avatar initials={person.initials} color={person.color} size={52} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold" style={{ color: '#1A1714' }}>{person.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#4A9B6F' }}>Available now</p>
                  </div>
                  <button className="text-sm font-semibold px-4 py-2 rounded-xl flex-shrink-0"
                    style={{ color: '#C4622D', background: '#F5E8DF' }}
                    onClick={e => talkOrBusy(person, e)}>
                    Talk
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {busyPeople.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9C9590' }}>On a call</p>
            <div className="flex flex-col gap-3 mb-8">
              {busyPeople.map(person => (
                <div key={person.id} className="flex items-center gap-4 py-4 px-4 rounded-2xl" style={{ background: '#F2EFE9' }}
                  onClick={() => onPersonTap(person)}>
                  <Avatar initials={person.initials} color={person.color} size={52} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold" style={{ color: '#1A1714' }}>{person.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#C47A2D' }}>On a call</p>
                  </div>
                  <span className="text-sm font-medium px-4 py-2 rounded-xl flex-shrink-0"
                    style={{ color: '#9C9590', background: '#EBE7E1' }}>
                    Busy
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9C9590' }}>Your people</p>
        <div className="flex flex-col gap-3">
          {loading && <p className="text-sm" style={{ color: '#9C9590' }}>Loading…</p>}
          {!loading && people.length === 0 && available.length === 0 && busyPeople.length === 0 && (
            <p className="text-sm" style={{ color: '#9C9590' }}>
              No one here yet. When someone goes Available on Profile, they’ll show up.
            </p>
          )}
          {people.map(person => (
            <div
              key={person.id}
              className="flex items-center gap-4 py-4 px-4 rounded-2xl text-left transition-all cursor-pointer"
              style={{ background: '#F2EFE9' }}
              onClick={() => onPersonTap(person)}
            >
              <Avatar initials={person.initials} color={person.color} size={52} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold" style={{ color: '#1A1714' }}>{person.name}</p>
                <p className="text-xs mt-0.5" style={{
                  color: person.busy ? '#C47A2D' : person.online ? '#4A9B6F' : '#9C9590',
                }}>
                  {presenceLabel(person)}
                </p>
              </div>
              {person.busy ? (
                <span className="text-sm font-medium px-4 py-2 rounded-xl flex-shrink-0"
                  style={{ color: '#9C9590', background: '#EBE7E1' }}>
                  Busy
                </span>
              ) : (
                <button
                  className="text-sm font-semibold px-4 py-2 rounded-xl transition-all active:scale-95 flex-shrink-0"
                  style={{ color: '#C4622D', background: '#F5E8DF' }}
                  onClick={e => talkOrBusy(person, e)}
                >
                  Talk
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <BottomNav tab="people" setTab={setTab} setScreen={setScreen} />
    </div>
  )
}

function PersonScreen({
  person,
  onBack,
  onTalk,
}: {
  person: Person
  onBack: () => void
  onTalk: () => void
}) {
  return (
    <div className="flex flex-col h-full" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center pt-14 pb-8 px-6" style={{ background: '#F2EFE9' }}>
          <button className="self-start mb-6 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: '#FAF8F5' }}
            onClick={onBack}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1714" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>

          <div className="relative mb-4">
            <Avatar initials={person.initials} color={person.color} size={88} />
            {person.online && (
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full border-2 flex items-center justify-center"
                style={{ background: '#F2EFE9', borderColor: '#FAF8F5' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4A9B6F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
            )}
          </div>

          <h1 className="font-bold mb-1" style={{ fontSize: 28, color: '#1A1714', letterSpacing: '-0.02em' }}>{person.name}</h1>
          <p className="text-sm" style={{ color: person.busy ? '#C47A2D' : person.online ? '#4A9B6F' : '#9C9590' }}>
            {presenceLabel(person)}
          </p>
        </div>

        <div className="px-6 pt-6">
          {person.busy ? (
            <button
              className="w-full py-4 rounded-2xl font-semibold text-lg mb-3"
              style={{ color: '#9C9590', background: '#EBE7E1' }}
              disabled
            >
              On a call
            </button>
          ) : (
            <button
              className="w-full py-4 rounded-2xl font-semibold text-white text-lg transition-all active:scale-95 mb-3"
              style={{ background: '#C4622D' }}
              onClick={onTalk}
            >
              Talk again
            </button>
          )}
          <button className="w-full py-4 rounded-2xl font-medium text-base" style={{ color: '#9C9590', background: '#F2EFE9' }} onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  )
}

function ListenerCallOverlay({ status, callId }: { status: string; callId: string | null }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const secs = String(elapsed % 60).padStart(2, '0')
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center px-8 text-center"
      style={{ background: '#1A1714' }}>
      <h1 className="font-bold mb-2" style={{ fontSize: 24, color: '#F0EDE8' }}>On a call</h1>
      <p className="mb-2" style={{ color: 'rgba(240,237,232,0.5)' }}>{status || 'Connected'}</p>
      <p className="font-bold tabular-nums mb-8" style={{ fontSize: 48, color: '#F0EDE8' }}>{mins}:{secs}</p>
      <button className="w-full py-4 rounded-2xl font-semibold text-white" style={{ background: '#C44040' }}
        onClick={() => signaling.send({ type: 'call.end', call_id: callId })}>
        End call
      </button>
    </div>
  )
}

function ProfileScreen({
  setTab,
  setScreen,
  userName,
}: {
  setTab: (t: Tab) => void
  setScreen: (s: Screen) => void
  userName: string
}) {
  const [available, setAvailable] = useState(isListenerAvailablePreferred())
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState(
    isListenerAvailablePreferred() ? 'Staying available — calls will pop up anywhere' : '',
  )

  useEffect(() => {
    if (!isListenerAvailablePreferred()) return
    let alive = true
    setBusy(true)
    ensureListenerPresence()
      .then((ok) => {
        if (!alive) return
        setAvailable(ok)
        setStatusMsg(ok ? 'Staying available — calls will pop up anywhere' : 'Couldn’t restore availability')
      })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [])

  async function toggleAvailable() {
    if (busy) return
    setBusy(true)
    setStatusMsg('')
    try {
      if (available) {
        await goListenerOffline()
        setAvailable(false)
        setStatusMsg('')
      } else {
        await goListenerOnline()
        setAvailable(true)
        setStatusMsg('Staying available — turn off anytime to stop receiving calls')
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Failed to go online')
      setAvailable(false)
    } finally {
      setBusy(false)
    }
  }

  const initials = userName.slice(0, 1).toUpperCase() || 'U'
  const settings = ['Notifications', 'Privacy', 'Safety', 'Account', 'Help']

  return (
    <div className="flex flex-col h-full" style={{ background: '#FAF8F5' }}>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center pt-14 pb-8 px-6" style={{ background: '#F2EFE9' }}>
          <Avatar initials={initials} color="#4A7FA5" size={80} />
          <h1 className="font-bold mt-4 mb-1" style={{ fontSize: 22, color: '#1A1714' }}>{userName}</h1>
          <p className="text-sm text-center" style={{ color: '#9C9590' }}>Just looking to have a good conversation.</p>

          <button
            className="mt-5 flex items-center gap-3 px-5 py-3 rounded-2xl transition-all"
            style={{ background: available ? '#E0F2EB' : '#F2EFE9', opacity: busy ? 0.7 : 1 }}
            onClick={toggleAvailable}
            disabled={busy}
          >
            <div className="w-11 h-6 rounded-full relative transition-colors"
              style={{ background: available ? '#4A9B6F' : '#D8D4CE' }}>
              <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                style={{ left: available ? '50%' : 2 }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: available ? '#4A9B6F' : '#9C9590' }}>
              {busy ? 'Updating…' : available ? 'Available to talk' : 'Not available'}
            </span>
          </button>
          {statusMsg && (
            <p className="text-xs mt-3 text-center px-4" style={{ color: '#9C9590' }}>{statusMsg}</p>
          )}
        </div>

        <div className="px-6 pt-2">
          {settings.map(item => (
            <button key={item} className="w-full flex items-center justify-between py-4 border-b text-left"
              style={{ borderColor: '#E4E0D9' }}>
              <span className="text-sm font-medium" style={{ color: '#1A1714' }}>{item}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D8D4CE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ))}
          <button
            className="w-full py-4 mt-4 text-sm font-medium"
            style={{ color: '#C44040' }}
            onClick={() => {
              goListenerOffline().catch(() => {})
              clearToken()
              setScreen('welcome')
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      <BottomNav tab="profile" setTab={setTab} setScreen={setScreen} />
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [tab, setTab] = useState<Tab>('home')
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null)
  const [authEmail, setAuthEmail] = useState('')
  const [userName, setUserName] = useState('there')
  const [callId, setCallId] = useState('')
  const [listenerId, setListenerId] = useState('')
  const [peerName, setPeerName] = useState('Someone')
  const [preferListenerId, setPreferListenerId] = useState<string | undefined>()
  const [findError, setFindError] = useState('')
  const [incoming, setIncoming] = useState<{ callId: string; duration: number } | null>(null)
  const [listenerInCall, setListenerInCall] = useState(false)
  const [listenerCallStatus, setListenerCallStatus] = useState('')
  const listenerSessionRef = useRef<BrowserAudioCall | null>(null)
  const listenerCallIdRef = useRef<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        // Magic-link / confirm-email redirect (Supabase puts tokens in the URL).
        await consumeAuthRedirect()
        if (!getToken()) return
        await refreshSessionIfNeeded()
        const me = await fetchMe()
        if (me.display_name?.trim()) {
          setUserName(me.display_name.trim())
          setScreen('home')
        } else {
          setScreen('auth_profile')
        }
      } catch {
        /* stay on welcome if token invalid */
      }
    })()
  }, [])

  // Restore "Available to talk" after refresh / login without toggling again.
  useEffect(() => {
    if (!getToken()) return
    if (['welcome', 'auth_email', 'auth_otp', 'auth_profile'].includes(screen)) return
    if (!isListenerAvailablePreferred()) return
    void ensureListenerPresence()
  }, [screen])

  async function continueAfterLogin() {
    try {
      const me = await fetchMe()
      const name = me.display_name?.trim()
      if (name) {
        setUserName(name)
        go('home')
        return
      }
    } catch {
      /* fall through to profile setup */
    }
    go('auth_profile')
  }
  // Global listener: accept/decline works on any screen (not only Profile).
  useEffect(() => {
    const loggedIn = !!getToken() && !['welcome', 'auth_email', 'auth_otp', 'auth_profile'].includes(screen)
    if (!loggedIn) return

    const peek = signaling.peekIncoming()
    if (peek) setIncoming({ callId: peek.callId, duration: peek.duration })

    const off = signaling.onMessage(async (msg) => {
      if (msg.type === 'call.incoming') {
        setIncoming({
          callId: String(msg.call_id),
          duration: Number(msg.duration) || 600,
        })
      }
      if (msg.type === 'call.state' && listenerCallIdRef.current && String(msg.call_id) === listenerCallIdRef.current) {
        setListenerCallStatus(String(msg.status || ''))
      }
      if (
        listenerCallIdRef.current &&
        String(msg.call_id) === listenerCallIdRef.current &&
        (msg.type === 'webrtc.offer' || msg.type === 'webrtc.ice' || msg.type === 'webrtc.answer')
      ) {
        await listenerSessionRef.current?.handleRemote(msg)
      }
      if (msg.type === 'call.ended') {
        const endedId = String(msg.call_id || '')
        if (listenerCallIdRef.current && endedId === listenerCallIdRef.current) {
          await listenerSessionRef.current?.stop()
          listenerSessionRef.current = null
          listenerCallIdRef.current = null
          setListenerInCall(false)
          setListenerCallStatus('')
          signaling.send({ type: 'listener.available' })
        }
        setIncoming((prev) => {
          if (prev && prev.callId === endedId) {
            signaling.clearIncoming(endedId)
            return null
          }
          return prev
        })
      }
    })
    return () => { off() }
  }, [screen])

  async function acceptIncoming() {
    if (!incoming) return
    const id = incoming.callId
    listenerCallIdRef.current = id
    signaling.send({ type: 'call.accept', call_id: id })
    signaling.clearIncoming(id)
    setIncoming(null)
    setListenerInCall(true)
    setListenerCallStatus('Connecting…')
    const sess = new BrowserAudioCall(id, false, {
      onState: (s) => {
        if (s === 'connected') setListenerCallStatus('Talking')
        else if (s === 'reconnecting') setListenerCallStatus('Reconnecting…')
        else if (s === 'mic-denied') setListenerCallStatus('Microphone blocked')
        else if (s === 'failed') setListenerCallStatus('Connection failed')
        else if (s === 'connecting' || s === 'requesting-mic') setListenerCallStatus('Connecting…')
      },
    })
    listenerSessionRef.current = sess
    try {
      await sess.start()
    } catch (e) {
      const msg = e instanceof MicPermissionError ? e.message : 'Allow microphone to talk'
      setListenerCallStatus(msg)
      signaling.send({ type: 'call.end', call_id: id, reason: 'MIC_DENIED' })
      setListenerInCall(false)
      await sess.stop()
      listenerSessionRef.current = null
      listenerCallIdRef.current = null
    }
  }

  function declineIncoming() {
    if (!incoming) return
    signaling.send({ type: 'call.decline', call_id: incoming.callId })
    signaling.clearIncoming(incoming.callId)
    setIncoming(null)
  }

  const go = (s: Screen) => setScreen(s)
  const startTalkFlow = (person?: Person) => {
    setFindError('')
    setPreferListenerId(person?.id)
    if (person) {
      setPeerName(person.name)
      setListenerId(person.id)
    }
    go('finding')
  }

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: '#111110', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="relative overflow-hidden flex flex-col"
        style={{ width: 390, height: 844, background: '#FAF8F5', borderRadius: 40, boxShadow: '0 32px 80px rgba(0,0,0,0.5)' }}>

        {/* Incoming call — any screen */}
        {incoming && !listenerInCall && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center px-8 text-center"
            style={{ background: 'rgba(250,248,245,0.97)' }}>
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: '#E0F2EB' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4A9B6F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18v-6a9 9 0 0118 0v6" />
                <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5z" />
                <path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z" />
              </svg>
            </div>
            <h1 className="font-bold mb-2" style={{ fontSize: 28, color: '#1A1714' }}>Someone wants to talk</h1>
            <p className="mb-8" style={{ color: '#9C9590' }}>Talk as long as you like</p>
            <button className="w-full py-4 rounded-2xl font-semibold text-white text-lg mb-3" style={{ background: '#4A9B6F' }}
              onClick={() => void acceptIncoming()}>
              Accept
            </button>
            <button className="w-full py-4 rounded-2xl font-medium" style={{ background: '#F2EFE9', color: '#9C9590' }}
              onClick={declineIncoming}>
              Decline
            </button>
          </div>
        )}

        {/* Listener in-call overlay */}
        {listenerInCall && (
          <ListenerCallOverlay
            status={listenerCallStatus}
            callId={listenerCallIdRef.current}
          />
        )}

        {/* Status bar */}
        {screen !== 'call' && !incoming && !listenerInCall && (
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-7 pt-3 pb-1"
            style={{ background: screen === 'onboarding' || screen === 'microphone' || screen === 'duration' || screen === 'finding' || screen === 'found' || screen === 'ending' || screen === 'rate' || screen === 'talkagain' ? '#FAF8F5' : screen === 'person' ? '#F2EFE9' : '#FAF8F5' }}>
            <span className="text-xs font-semibold" style={{ color: '#1A1714' }}>9:41</span>
            <div className="flex items-center gap-1.5">
              <svg width="16" height="11" viewBox="0 0 16 11" fill="#1A1714">
                <rect x="0" y="5" width="3" height="6" rx="0.5" opacity="0.4" />
                <rect x="4" y="3" width="3" height="8" rx="0.5" opacity="0.6" />
                <rect x="8" y="1" width="3" height="10" rx="0.5" opacity="0.8" />
                <rect x="12" y="0" width="3" height="11" rx="0.5" />
              </svg>
              <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="#1A1714" strokeWidth="1.2">
                <path d="M1 8c1.7-1.7 4-2.7 6.5-2.7s4.8 1 6.5 2.7" opacity="0.4" />
                <path d="M3.5 5.5c1.1-1.1 2.5-1.8 4-1.8s3 0.7 4 1.8" opacity="0.7" />
                <path d="M6 3c.8-.8 1.8-1.3 1.5-1.3s.7.5 1.5 1.3" />
                <circle cx="7.5" cy="9.5" r="1" fill="#1A1714" stroke="none" />
              </svg>
              <div className="flex items-center gap-0.5">
                <div className="rounded-sm" style={{ width: 22, height: 11, border: '1px solid rgba(26,23,20,0.35)', padding: 1.5 }}>
                  <div className="h-full rounded-sm" style={{ width: '80%', background: '#1A1714' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col">
          {screen === 'welcome' && <WelcomeScreen onNext={() => go('auth_email')} />}
          {screen === 'auth_email' && <EmailScreen onSent={email => { setAuthEmail(email); go('auth_otp') }} />}
          {screen === 'auth_otp' && (
            <OTPScreen
              email={authEmail}
              onVerified={() => continueAfterLogin()}
              onBack={() => go('auth_email')}
            />
          )}
          {screen === 'auth_profile' && (
            <ProfileSetupScreen onDone={p => { setUserName(p.name); go('onboarding') }} />
          )}
          {screen === 'onboarding' && <OnboardingScreen onDone={() => go('microphone')} />}
          {screen === 'microphone' && (
            <MicrophoneScreen onAllow={() => go('home')} />
          )}
          {screen === 'home' && (
            <HomeScreen
              onTalkNow={() => startTalkFlow()}
              onTalkPerson={(p) => startTalkFlow(p)}
              setTab={setTab}
              setScreen={setScreen}
              userName={userName}
            />
          )}
          {screen === 'finding' && (
            <FindingScreen
              preferListenerId={preferListenerId}
              onFound={(info) => {
                setCallId(info.callId)
                setListenerId(info.listenerId || listenerId)
                if (info.name && info.name !== 'Someone') setPeerName(info.name)
                else if (!preferListenerId) setPeerName(info.name || 'Someone')
                go('found')
              }}
              onFailed={(reason) => {
                setFindError(reason)
                setPreferListenerId(undefined)
                go('home')
              }}
            />
          )}
          {screen === 'found' && callId && (
            <FoundScreen
              peerName={peerName}
              callId={callId}
              onStart={() => go('call')}
              onSkip={() => {
                signaling.send({ type: 'call.end', call_id: callId })
                setPreferListenerId(undefined)
                go('finding')
              }}
              onTimeout={() => {
                setFindError('NO_LISTENER')
                go('home')
              }}
            />
          )}
          {screen === 'call' && callId && (
            <CallScreen
              callId={callId}
              peerName={peerName}
              onEnd={() => {
                go('ending')
                setTimeout(() => go('rate'), 1400)
              }}
            />
          )}
          {screen === 'ending' && <EndingScreen />}
          {screen === 'rate' && (
            <RateScreen
              callId={callId}
              listenerId={listenerId}
              peerName={peerName}
              onDone={() => go('talkagain')}
            />
          )}
          {screen === 'talkagain' && (
            <TalkAgainScreen
              peerName={peerName}
              onTalkAgain={() => go('finding')}
              onLater={() => { setTab('home'); go('home') }}
            />
          )}
          {screen === 'people' && (
            <PeopleScreen
              setTab={setTab}
              setScreen={setScreen}
              onPersonTap={p => { setSelectedPerson(p); go('person') }}
              onTalk={p => startTalkFlow(p)}
            />
          )}
          {screen === 'person' && selectedPerson && (
            <PersonScreen
              person={selectedPerson}
              onBack={() => go('people')}
              onTalk={() => startTalkFlow(selectedPerson)}
            />
          )}
          {screen === 'profile' && <ProfileScreen setTab={setTab} setScreen={setScreen} userName={userName} />}
          {findError && screen === 'home' && (
            <div className="absolute bottom-24 left-6 right-6 px-4 py-3 rounded-2xl text-sm text-center"
              style={{ background: '#FDF0F0', color: '#C44040' }}>
              {findError === 'NO_LISTENER'
                ? 'Nobody is available right now. Open another browser as a listener, or try again.'
                : findError === 'NOT_AUTHENTICATED'
                  ? 'Please log in again.'
                  : `Couldn’t connect (${findError}). Is the backend running on :8081?`}
              <button className="block mx-auto mt-2 font-semibold" onClick={() => setFindError('')}>Dismiss</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
