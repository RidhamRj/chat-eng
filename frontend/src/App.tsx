import { FormEvent, useEffect, useRef, useState } from 'react'
import './App.css'

type User = {
  id: string
  username: string
}

type Session = {
  authenticated: boolean
  signupAvailable?: boolean
  ready?: boolean
  user?: User
  partner?: User | null
}

type Message = {
  id: string
  senderId: string
  text: string
  createdAt: string
}

type AuthMode = 'login' | 'signup'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(body.error || 'Unable to complete the request.')
  }

  return body as T
}

function App() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [chatError, setChatError] = useState('')
  const [messageText, setMessageText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadSession = async () => {
    try {
      const nextSession = await request<Session>('/api/session')
      setSession(nextSession)
      setAuthError('')

      if (!nextSession.signupAvailable && mode === 'signup' && !nextSession.authenticated) {
        setMode('login')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to load the chat.')
      setSession({ authenticated: false, signupAvailable: true })
    }
  }

  const loadMessages = async () => {
    try {
      const result = await request<{ messages: Message[] }>('/api/messages')
      setMessages(result.messages)
      setChatError('')
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Unable to load messages.')
    }
  }

  useEffect(() => {
    loadSession()
  }, [])

  useEffect(() => {
    if (!session?.authenticated) return

    if (!session.ready) {
      const timer = window.setInterval(loadSession, 3000)
      return () => window.clearInterval(timer)
    }

    loadMessages()
    const timer = window.setInterval(loadMessages, 3000)
    return () => window.clearInterval(timer)
  }, [session?.authenticated, session?.ready])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setAuthError('')

    try {
      await request(`/api/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      setUsername('')
      setPassword('')
      await loadSession()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to continue.')
    } finally {
      setSubmitting(false)
    }
  }

  const signOut = async () => {
    try {
      await request('/api/logout', { method: 'POST', body: '{}' })
    } finally {
      setMessages([])
      setMode('login')
      await loadSession()
    }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = messageText.trim()
    if (!text || submitting) return

    setSubmitting(true)
    setChatError('')
    setMessageText('')

    try {
      const result = await request<{ message: Message }>('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      setMessages(current => [...current.filter(message => message.id !== result.message.id), result.message])
    } catch (error) {
      setMessageText(text)
      setChatError(error instanceof Error ? error.message : 'Unable to send the message.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!session) {
    return <main className="loading-screen">Loading...</main>
  }

  if (!session.authenticated) {
    return (
      <main className="page-shell">
        <section className="auth-panel">
          <div className="brand">Chat</div>
          <h1>Talk privately</h1>
          <p className="intro">Create two accounts and start chatting.</p>

          <div className="auth-tabs">
            <button
              className={mode === 'login' ? 'auth-tab active' : 'auth-tab'}
              type="button"
              onClick={() => {
                setMode('login')
                setAuthError('')
              }}
            >
              Sign in
            </button>
            <button
              className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'}
              type="button"
              disabled={!session.signupAvailable}
              onClick={() => {
                setMode('signup')
                setAuthError('')
              }}
            >
              Create account
            </button>
          </div>

          <form className="auth-form" onSubmit={submitAuth}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              minLength={3}
              maxLength={20}
              autoComplete="username"
              required
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              minLength={6}
              maxLength={72}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
            />

            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? 'Please wait' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="form-message" role="status">{authError}</p>
        </section>
      </main>
    )
  }

  if (!session.ready || !session.user) {
    return (
      <main className="page-shell">
        <section className="waiting-panel">
          <div className="brand">Chat</div>
          <h1>Account created</h1>
          <p>Ask the second person to create their account. The chat will open automatically.</p>
          <div className="account-line">Signed in as {session.user?.username}</div>
          <button className="text-button" type="button" onClick={signOut}>Sign out</button>
        </section>
      </main>
    )
  }

  const currentUser = session.user
  const partner = session.partner

  return (
    <main className="chat-shell">
      <section className="chat-panel">
        <header className="chat-header">
          <div className="avatar">{partner?.username.slice(0, 1).toUpperCase()}</div>
          <div className="chat-person">
            <strong>{partner?.username}</strong>
            <span>Private conversation</span>
          </div>
          <button className="text-button" type="button" onClick={signOut}>Sign out</button>
        </header>

        <div className="messages" aria-live="polite">
          {messages.length === 0 && <p className="empty-message">No messages yet</p>}
          {messages.map(message => (
            <div className={message.senderId === currentUser.id ? 'message-row mine' : 'message-row'} key={message.id}>
              <div className="message-bubble">
                <p>{message.text}</p>
                <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form className="message-form" onSubmit={sendMessage}>
          <input
            value={messageText}
            onChange={event => setMessageText(event.target.value)}
            maxLength={500}
            placeholder="Write a message"
            autoComplete="off"
            required
          />
          <button className="send-button" type="submit" disabled={submitting}>Send</button>
        </form>
        <p className="chat-error" role="status">{chatError}</p>
      </section>
    </main>
  )
}

export default App
