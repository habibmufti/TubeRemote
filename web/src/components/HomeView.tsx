import { useEffect, useRef } from 'react'
import { SearchResult } from '../hooks/useSocket'
import './SearchView.css'
import './HomeView.css'

interface Props {
  results: SearchResult[]
  loading: boolean
  loadingMore: boolean
  onRefresh: () => void
  onLoadMore: () => void
  onPlayVideo: (videoId: string) => void
}

const IconPlay = () => <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
  </svg>
)

export default function HomeView({ results, loading, loadingMore, onRefresh, onLoadMore, onPlayVideo }: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loading && !loadingMore && results.length > 0) {
          onLoadMore()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading, loadingMore, results.length, onLoadMore])

  return (
    <div className="sv">
      <div className="home-toolbar">
        <span className="home-toolbar-title">YouTube Home</span>
        <button className="home-refresh-btn" onClick={onRefresh} disabled={loading} aria-label="Refresh">
          {loading ? <div className="spinner-sm" /> : <IconRefresh />}
        </button>
      </div>

      <div className="results">
        {loading && results.length === 0 && (
          <div className="sv-empty">
            <div className="spinner" />
            <span>Loading home videos...</span>
          </div>
        )}
        {!loading && results.length === 0 && (
          <div className="sv-empty">
            <span>Press refresh to load YouTube home videos.</span>
          </div>
        )}
        {results.map((r) => (
          <button key={r.videoId} className="result-item" onClick={() => onPlayVideo(r.videoId)}>
            <div className="thumb">
              {r.thumbnail && <img src={r.thumbnail} alt="" loading="lazy" />}
              {r.duration && <span className="duration">{r.duration}</span>}
            </div>
            <div className="result-info">
              <div className="result-title">{r.title}</div>
              <div className="result-channel">{r.channelName}</div>
            </div>
            <div className="play-arrow"><IconPlay /></div>
          </button>
        ))}
        <div ref={sentinelRef} className="load-more-sentinel">
          {loadingMore && <div className="spinner-sm" />}
        </div>
      </div>
    </div>
  )
}
