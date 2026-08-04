import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error'

type ChatMessage = {
  id: string
  sender: string
  text: string
  sentAt: number
}

const socketUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'

function App() {
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connection, setConnection] = useState<ConnectionState>('idle')
  const [error, setError] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const manualCloseRef = useRef(false)
  const messageEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      manualCloseRef.current = true
      socketRef.current?.close()
    }
  }, [])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const cleanName = name.trim()
    const cleanRoomId = roomId.trim()

    if (!cleanName || !cleanRoomId) {
      setError('Enter your name and a room ID.')
      return
    }

    setError('')
    setConnection('connecting')
    manualCloseRef.current = false

    const socket = new WebSocket(socketUrl)
    socketRef.current = socket

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'join',
        payload: { roomId: cleanRoomId },
      }))
      setConnection('connected')
    }

    socket.onmessage = event => {
      const rawMessage = String(event.data)

      try {
        const message = JSON.parse(rawMessage) as ChatMessage

        if (
          typeof message.id === 'string' &&
          typeof message.sender === 'string' &&
          typeof message.text === 'string' &&
          typeof message.sentAt === 'number'
        ) {
          setMessages(current => {
            if (current.some(item => item.id === message.id)) return current
            return [...current, message]
          })
          return
        }
      } catch {
        setMessages(current => [
          ...current,
          {
            id: crypto.randomUUID(),
            sender: 'Room',
            text: rawMessage,
            sentAt: Date.now(),
          },
        ])
      }
    }

    socket.onerror = () => {
      setError(`Could not connect to ${socketUrl}.`)
      setConnection('error')
    }

    socket.onclose = () => {
      socketRef.current = null

      if (manualCloseRef.current) {
        setConnection('idle')
        return
      }

      setError('Connection closed. Start the backend and join again.')
      setConnection('error')
    }
  }

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const text = draft.trim()
    const socket = socketRef.current

    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      sender: name.trim(),
      text,
      sentAt: Date.now(),
    }

    socket.send(JSON.stringify({
      type: 'chat',
      payload: {
        message: JSON.stringify(message),
      },
    }))

    setDraft('')
  }

  const leaveRoom = () => {
    manualCloseRef.current = true
    socketRef.current?.close()
    socketRef.current = null
    setMessages([])
    setDraft('')
    setError('')
    setConnection('idle')
  }

  if (connection !== 'connected') {
    return (
      <main className="page-shell">
        <section className="join-panel">
          <div className="brand">Chat Engine</div>
          <h1>Join a room</h1>
          <p className="intro">Use the same room ID on both devices.</p>

          <form className="join-form" onSubmit={connect}>
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={24}
              autoComplete="name"
              placeholder="Ridham"
              disabled={connection === 'connecting'}
              required
            />

            <label htmlFor="roomId">Room ID</label>
            <input
              id="roomId"
              value={roomId}
              onChange={event => setRoomId(event.target.value)}
              maxLength={40}
              autoComplete="off"
              placeholder="room-101"
              disabled={connection === 'connecting'}
              required
            />

            <button className="primary-button" type="submit" disabled={connection === 'connecting'}>
              {connection === 'connecting' ? 'Connecting...' : 'Join room'}
            </button>
          </form>

          <p className="form-message" role="status">{error}</p>
          <p className="server-note">Backend: {socketUrl}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="chat-shell">
      <section className="chat-panel">
        <header className="chat-header">
          <div className="room-details">
            <strong>Room {roomId.trim()}</strong>
            <span><span className="status-dot" />Connected as {name.trim()}</span>
          </div>
          <button className="text-button" type="button" onClick={leaveRoom}>Leave</button>
        </header>

        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty-state">
              <strong>No messages yet</strong>
              <span>Ask the other person to join this room.</span>
            </div>
          )}

          {messages.map(message => {
            const isMine = message.sender === name.trim()

            return (
              <div className={isMine ? 'message-row mine' : 'message-row'} key={message.id}>
                <div className="message-bubble">
                  {!isMine && <span className="message-sender">{message.sender}</span>}
                  <p>{message.text}</p>
                  <time>{new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              </div>
            )
          })}
          <div ref={messageEndRef} />
        </div>

        <form className="message-form" onSubmit={sendMessage}>
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            maxLength={500}
            placeholder="Write a message"
            autoComplete="off"
            required
          />
          <button className="send-button" type="submit">Send</button>
        </form>
      </section>
    </main>
  )
}

export default App
