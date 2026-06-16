import { useState, useCallback, useEffect } from 'react'
import { useSocket, PlayerState, SearchResult, Comment, VideoInfo } from './hooks/useSocket'
import RemoteControl from './components/RemoteControl'
import SearchView from './components/SearchView'
import HomeView from './components/HomeView'
import './App.css'

function getToken(): string {
  return new URLSearchParams(location.search).get('token') ?? ''
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
)

type Tab = 'remote' | 'search' | 'home'

export default function App() {
  const token = getToken()
  const [tab, setTab] = useState<Tab>('remote')
  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false, currentTime: 0, duration: 0,
    volume: 100, isMuted: false, title: '', channelName: '',
    videoId: '', quality: '', availableQualities: [],
  })
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoadingMore, setSearchLoadingMore] = useState(false)
  const [homeResults, setHomeResults] = useState<SearchResult[]>([])
  const [homeLoading, setHomeLoading] = useState(false)
  const [homeLoadingMore, setHomeLoadingMore] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false)
  const [commentsCursor, setCommentsCursor] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo>({ description: '', author: '', views: '' })
  const [extConnected, setExtConnected] = useState(false)

  // Quality info arrives on its own QUALITY_INFO event; the frequent PLAYER_STATE
  // pushes don't carry it, so preserve the last known quality instead of wiping it.
  const onPlayerState = useCallback((state: PlayerState) => {
    setPlayerState(prev => ({
      ...state,
      quality: state.quality || prev.quality,
      availableQualities: state.availableQualities?.length ? state.availableQualities : prev.availableQualities,
    }))
  }, [])

  const onPeerConnected    = useCallback(() => setExtConnected(true), [])
  const onPeerDisconnected = useCallback(() => setExtConnected(false), [])
  const onSearchResults    = useCallback((r: SearchResult[]) => {
    setSearchResults(r)
    setSearchLoadingMore(false)
    setTab('search')
  }, [])
  const onSearchMoreResults = useCallback((r: SearchResult[]) => {
    setSearchResults(prev => [...prev, ...r])
    setSearchLoadingMore(false)
  }, [])
  const onHomeResults = useCallback((r: SearchResult[]) => {
    setHomeResults(r)
    setHomeLoading(false)
    setHomeLoadingMore(false)
  }, [])
  const onHomeMoreResults = useCallback((r: SearchResult[]) => {
    setHomeResults(prev => [...prev, ...r])
    setHomeLoadingMore(false)
  }, [])

  const onQualityInfo = useCallback((quality: string, availableQualities: string[]) => {
    setPlayerState(prev => ({ ...prev, quality, availableQualities }))
  }, [])

  const { status, sendCommand } = useSocket({
    token, onPlayerState,
    onSearchResults, onSearchMoreResults, onHomeResults, onHomeMoreResults,
    onQualityInfo, onPeerConnected, onPeerDisconnected,
  })

  // On video change: reset comments and auto-load the description (lightweight,
  // fetched server-side by the local binary via the native YouTube API).
  useEffect(() => {
    setComments([])
    setCommentsCursor('')
    setVideoInfo({ description: '', author: '', views: '' })
    if (!playerState.videoId) return
    let cancelled = false
    fetch(`/api/video?v=${encodeURIComponent(playerState.videoId)}&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setVideoInfo({ description: d.description || '', author: d.author || '', views: d.views || '' }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [playerState.videoId, token])

  // Comments are fetched server-side too — no page scrolling on the PC, and it
  // works even for videos opened manually on the PC.
  const loadComments = useCallback(async () => {
    if (!playerState.videoId) return
    setCommentsLoading(true)
    try {
      const res = await fetch(`/api/comments?v=${encodeURIComponent(playerState.videoId)}&token=${encodeURIComponent(token)}`)
      const data = await res.json()
      setComments(Array.isArray(data.comments) ? data.comments : [])
      setCommentsCursor(data.continuation || '')
    } catch {
      setComments([])
      setCommentsCursor('')
    } finally {
      setCommentsLoading(false)
    }
  }, [playerState.videoId, token])

  const loadMoreComments = useCallback(async () => {
    if (!commentsCursor) return
    setCommentsLoadingMore(true)
    try {
      const res = await fetch(`/api/comments?continuation=${encodeURIComponent(commentsCursor)}&token=${encodeURIComponent(token)}`)
      const data = await res.json()
      setComments(prev => [...prev, ...(Array.isArray(data.comments) ? data.comments : [])])
      setCommentsCursor(data.continuation || '')
    } catch {
      // keep what we have; cursor unchanged so the user can retry
    } finally {
      setCommentsLoadingMore(false)
    }
  }, [commentsCursor, token])

  const loadMoreSearch = useCallback(() => {
    setSearchLoadingMore(true)
    sendCommand('SCROLL_SEARCH')
    setTimeout(() => setSearchLoadingMore(false), 8000)
  }, [sendCommand])

  const loadHomeVideos = useCallback(() => {
    setHomeLoading(true)
    setHomeLoadingMore(false)
    sendCommand('GET_HOME_VIDEOS')
    setTimeout(() => setHomeLoading(false), 15000)
  }, [sendCommand])

  const loadMoreHomeVideos = useCallback(() => {
    setHomeLoadingMore(true)
    sendCommand('SCROLL_HOME')
    setTimeout(() => setHomeLoadingMore(false), 8000)
  }, [sendCommand])

  if (!token || status === 'unauthorized') {
    return (
      <div className="no-token">
        <div className="no-token-icon"><PlayIcon /></div>
        <h1>TubeRemote</h1>
        <p>
          {status === 'unauthorized'
            ? 'This link has expired — the desktop app restarted with a new code. Rescan the QR from the Chrome extension popup to reconnect.'
            : 'Scan the QR code from the Chrome extension popup to connect.'}
        </p>
      </div>
    )
  }

  const connected = status === 'connected'
  const statusLabel = !connected ? 'Offline' : extConnected ? 'Connected' : 'Waiting...'

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-mark"><PlayIcon /></div>
          <span className="logo-name">TubeRemote</span>
        </div>
        <div className="status-badge">
          <span className={`dot ${connected && extConnected ? 'on' : 'off'}`} />
          <span className="badge-text">{statusLabel}</span>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === 'remote' ? 'active' : ''}`} onClick={() => setTab('remote')}>
          Remote
        </button>
        <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
          Search
        </button>
        <button className={`tab ${tab === 'home' ? 'active' : ''}`} onClick={() => { setTab('home'); loadHomeVideos() }}>
          Home
        </button>
      </nav>

      <main className="content">
        {tab === 'remote' && (
          <RemoteControl
            playerState={playerState}
            onCommand={sendCommand}
            description={videoInfo.description}
            views={videoInfo.views}
            comments={comments}
            commentsLoading={commentsLoading}
            commentsLoadingMore={commentsLoadingMore}
            hasMoreComments={!!commentsCursor}
            onLoadComments={loadComments}
            onLoadMoreComments={loadMoreComments}
          />
        )}
        {tab === 'search' && (
          <SearchView
            results={searchResults}
            loadingMore={searchLoadingMore}
            onSearch={(q) => sendCommand('SEARCH', { query: q })}
            onLoadMore={loadMoreSearch}
            onPlayVideo={(id) => { sendCommand('PLAY_VIDEO', { videoId: id }); setTab('remote') }}
          />
        )}
        {tab === 'home' && (
          <HomeView
            results={homeResults}
            loading={homeLoading}
            loadingMore={homeLoadingMore}
            onRefresh={loadHomeVideos}
            onLoadMore={loadMoreHomeVideos}
            onPlayVideo={(id) => { sendCommand('PLAY_VIDEO', { videoId: id }); setTab('remote') }}
          />
        )}
      </main>
    </div>
  )
}
