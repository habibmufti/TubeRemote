import { useState, useEffect, useRef } from 'react'
import { SearchResult } from '../hooks/useSocket'
import './SearchView.css'

interface Props {
  results: SearchResult[]
  loadingMore: boolean
  onSearch: (query: string) => void
  onLoadMore: () => void
  onPlayVideo: (videoId: string) => void
}

const IconSearch = () => (
  <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
)

const IconPlay = () => (
  <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
)

export default function SearchView({ results, loadingMore, onSearch, onLoadMore, onPlayVideo }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (results.length > 0) setSearching(false)
  }, [results])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !searching && !loadingMore && results.length > 0) {
          onLoadMore()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [searching, loadingMore, results.length, onLoadMore])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    onSearch(query.trim())
    setTimeout(() => setSearching(false), 12000)
  }

  return (
    <div className="sv">
      <form onSubmit={handleSubmit} className="search-form">
        <input
          type="text"
          placeholder="Search YouTube..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-input"
          autoFocus
        />
        <button type="submit" className="search-btn" disabled={!query.trim() || searching}>
          {searching ? <div className="spinner-sm" /> : <IconSearch />}
        </button>
      </form>

      <div className="results">
        {searching && results.length === 0 && (
          <div className="sv-empty">
            <div className="spinner" />
            <span>Searching...</span>
          </div>
        )}
        {!searching && results.length === 0 && (
          <div className="sv-empty">
            <span>{query ? 'No results found.' : 'Search for videos to play on your PC.'}</span>
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
        {results.length > 0 && (
          <div ref={sentinelRef} className="load-more-sentinel">
            {loadingMore && <div className="spinner-sm" />}
          </div>
        )}
      </div>
    </div>
  )
}
