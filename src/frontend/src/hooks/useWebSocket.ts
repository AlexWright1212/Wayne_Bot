import { useEffect, useRef, useCallback, useState } from 'react'
import type { WSClientMessage, WSServerEvent } from '@/lib/types'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected' | 'idle'

interface UseWebSocketOptions {
  conversationId: string | null
  onEvent: (event: WSServerEvent) => void
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

/**
 * WebSocket hook — manages connection lifecycle with reconnection support.
 * Exponential backoff: 1s, 2s, 4s (3 attempts max).
 */
export function useWebSocket({ conversationId, onEvent }: UseWebSocketOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const wsRef = useRef<WebSocket | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const intentionalCloseRef = useRef(false)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId

  const connect = useCallback((convId: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${convId}`)

    ws.onopen = () => {
      retryCountRef.current = 0
      setConnectionStatus('connected')
    }

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WSServerEvent
        onEventRef.current(event)
      } catch {
        console.error('Failed to parse WebSocket message:', e.data)
      }
    }

    ws.onerror = (e) => {
      console.error('WebSocket error:', e)
    }

    ws.onclose = () => {
      wsRef.current = null

      // Don't reconnect if we closed intentionally (conversation switch / unmount)
      if (intentionalCloseRef.current) return

      const currentConvId = conversationIdRef.current
      if (!currentConvId || currentConvId !== convId) return

      if (retryCountRef.current < MAX_RETRIES) {
        setConnectionStatus('reconnecting')
        const delay = BASE_DELAY_MS * Math.pow(2, retryCountRef.current)
        retryCountRef.current += 1
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          // Re-check that conversation hasn't changed during the delay
          if (conversationIdRef.current === convId) {
            const newWs = connect(convId)
            wsRef.current = newWs
          }
        }, delay)
      } else {
        setConnectionStatus('disconnected')
      }
    }

    return ws
  }, [])

  // Manual reconnect (for the "Reconnect" button)
  const reconnect = useCallback(() => {
    if (!conversationIdRef.current) return
    // Clean up any existing connection
    if (wsRef.current) {
      intentionalCloseRef.current = true
      wsRef.current.close()
      intentionalCloseRef.current = false
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    retryCountRef.current = 0
    setConnectionStatus('reconnecting')
    wsRef.current = connect(conversationIdRef.current)
  }, [connect])

  useEffect(() => {
    // Clear any pending retry from the previous conversation
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    if (!conversationId) {
      setConnectionStatus('idle')
      return
    }

    intentionalCloseRef.current = false
    retryCountRef.current = 0
    wsRef.current = connect(conversationId)

    return () => {
      intentionalCloseRef.current = true
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [conversationId, connect])

  const send = useCallback((message: WSClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    } else {
      console.warn('WebSocket not connected, cannot send message')
    }
  }, [])

  return { send, connectionStatus, reconnect }
}
