import { useState, useCallback } from 'react'
import { useSocket, PlayerState, SearchResult } from './hooks/useSocket'
import RemoteControl from './components/RemoteControl'
import SearchView from './components/SearchView'
import './App.css'

function getToken(): string {
  return new URLSearchParams(location.search).get('token') ?? ''
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
)

type Tab = 'remote' | 'search'

export default function App() {
  const token = getToken()
  const [tab, setTab] = useState<Tab>('remote')
  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false, currentTime: 0, duration: 0,
    volume: 100, isMuted: false, title: '', channelName: '',
  })
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [extConnected, setExtConnected] = useState(false)

  const onPeerConnected    = useCallback(() => setExtConnected(true), [])
  const onPeerDisconnected = useCallback(() => setExtConnected(false), [])
  const onSearchResults    = useCallback((r: SearchResult[]) => {
    setSearchResults(r)
    setTab('search')
  }, [])

  const { status, sendCommand } = useSocket({
    token, onPlayerState: setPlayerState,
    onSearchResults, onPeerConnected, onPeerDisconnected,
  })

  if (!token) {
    return (
      <div className="no-token">
        <div className="no-token-icon"><PlayIcon /></div>
        <h1>TubeRemote</h1>
        <p>Scan the QR code from the Chrome extension popup to connect.</p>
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
      </nav>

      <main className="content">
        {tab === 'remote' && (
          <RemoteControl playerState={playerState} onCommand={sendCommand} />
        )}
        {tab === 'search' && (
          <SearchView
            results={searchResults}
            onSearch={(q) => sendCommand('SEARCH', { query: q })}
            onPlayVideo={(id) => { sendCommand('PLAY_VIDEO', { videoId: id }); setTab('remote') }}
          />
        )}
      </main>
    </div>
  )
}
