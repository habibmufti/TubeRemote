import { useEffect, useRef, useCallback, useState } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface PlayerState {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  title: string
  channelName: string
  videoId: string
  quality: string
  availableQualities: string[]
}

export interface SearchResult {
  videoId: string
  title: string
  channelName: string
  thumbnail: string
  duration: string
}

export interface Comment {
  author: string
  text: string
  likes: string
  avatar: string
}

interface UseSocketOptions {
  token: string
  onPlayerState: (state: PlayerState) => void
  onSearchResults: (results: SearchResult[]) => void
  onSearchMoreResults: (results: SearchResult[]) => void
  onHomeResults: (results: SearchResult[]) => void
  onHomeMoreResults: (results: SearchResult[]) => void
  onQualityInfo: (quality: string, availableQualities: string[]) => void
  onPeerConnected: () => void
  onPeerDisconnected: () => void
}

export function useSocket({
  token,
  onPlayerState,
  onSearchResults,
  onSearchMoreResults,
  onHomeResults,
  onHomeMoreResults,
  onQualityInfo,
  onPeerConnected,
  onPeerDisconnected,
}: UseSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ deviceType: 'remote', token }))
      setStatus('connected')
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        switch (msg.type) {
          case 'EVENT':
            if (msg.action === 'PLAYER_STATE' && msg.state) {
              onPlayerState(msg.state)
            } else if (msg.action === 'SEARCH_RESULTS' && msg.results) {
              onSearchResults(msg.results)
            } else if (msg.action === 'SEARCH_MORE_RESULTS' && msg.results) {
              onSearchMoreResults(msg.results)
            } else if (msg.action === 'HOME_RESULTS' && msg.results) {
              onHomeResults(msg.results)
            } else if (msg.action === 'HOME_MORE_RESULTS' && msg.results) {
              onHomeMoreResults(msg.results)
            } else if (msg.action === 'QUALITY_INFO') {
              onQualityInfo(msg.quality || '', msg.availableQualities || [])
            }
            break
          case 'PEER_CONNECTED':
            onPeerConnected()
            break
          case 'PEER_DISCONNECTED':
            onPeerDisconnected()
            break
        }
      } catch {}
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setStatus('disconnected')
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      setStatus('error')
      ws.close()
    }
  }, [token, onPlayerState, onSearchResults, onSearchMoreResults, onHomeResults, onHomeMoreResults, onQualityInfo, onPeerConnected, onPeerDisconnected])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const sendCommand = useCallback((action: string, payload?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'COMMAND', action, payload }))
    }
  }, [])

  return { status, sendCommand }
}
