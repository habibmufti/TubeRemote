import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { PlayerState, Comment } from '../hooks/useSocket'
import './RemoteControl.css'

interface Props {
  playerState: PlayerState
  onCommand: (action: string, payload?: Record<string, unknown>) => void
  description: string
  views: string
  comments: Comment[]
  commentsLoading: boolean
  commentsLoadingMore: boolean
  hasMoreComments: boolean
  onLoadComments: () => void
  onLoadMoreComments: () => void
}

function fmtTime(s: number) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

/* ── Icons ── */
const IcPrev = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
const IcNext = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
const IcPlay = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
const IcPause = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
const IcFullscreen = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
const IcComment = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
const IcRefresh = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
const IcLike = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>

const QUALITY_LABELS: Record<string, string> = {
  hd2160: '4K', hd1440: '1440p', hd1080: '1080p', hd720: '720p',
  large: '480p', medium: '360p', small: '240p', tiny: '144p', auto: 'Auto',
}
function qualityLabel(q: string) { return QUALITY_LABELS[q] ?? q }

function fmtViews(v: string) {
  const n = parseInt(v, 10)
  if (!n) return ''
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B views'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K views'
  return n + ' views'
}

function VolIcon({ v, muted }: { v: number; muted: boolean }) {
  if (muted || v === 0) return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
  if (v < 50) return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>
  return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
}

export default function RemoteControl({
  playerState, onCommand, description, views,
  comments, commentsLoading, commentsLoadingMore, hasMoreComments,
  onLoadComments, onLoadMoreComments,
}: Props) {
  const [localVol, setLocalVol] = useState(playerState.volume)
  const [seeking, setSeeking]   = useState(false)
  const [seekVal, setSeekVal]   = useState(0)
  const [displayTime, setDisplayTime] = useState(playerState.currentTime)
  const [titleOverflow, setTitleOverflow] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descOverflow, setDescOverflow] = useState(false)

  const qualityPickerRef = useRef<HTMLDivElement>(null)
  const descRef = useRef<HTMLDivElement>(null)
  const commentsSentinelRef = useRef<HTMLDivElement>(null)

  // Detect whether the (clamped) description is long enough to need a toggle.
  useEffect(() => {
    setDescExpanded(false)
    const el = descRef.current
    if (!el) { setDescOverflow(false); return }
    requestAnimationFrame(() => setDescOverflow(el.scrollHeight > el.clientHeight + 4))
  }, [description])

  // Infinite scroll for comments.
  useEffect(() => {
    const el = commentsSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMoreComments && !commentsLoading && !commentsLoadingMore) {
          onLoadMoreComments()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMoreComments, commentsLoading, commentsLoadingMore, onLoadMoreComments, comments.length])

  const orderedQualities = useMemo(() => {
    const order = ['hd2160','hd1440','hd1080','hd720','large','medium','small','tiny','auto']
    return [...playerState.availableQualities].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b)
    )
  }, [playerState.availableQualities])

  const titleInnerRef = useRef<HTMLSpanElement>(null)
  const titleWrapRef  = useRef<HTMLDivElement>(null)

  // Track last server-reported position + timestamp for interpolation
  const syncRef = useRef({ time: playerState.currentTime, ts: performance.now(), playing: false })

  useEffect(() => {
    syncRef.current = { time: playerState.currentTime, ts: performance.now(), playing: playerState.isPlaying }
    if (!seeking) setDisplayTime(playerState.currentTime)
  }, [playerState.currentTime, playerState.isPlaying, seeking])

  // Smooth seek bar: interpolate locally every 500ms while playing
  useEffect(() => {
    if (!playerState.isPlaying || seeking) return
    const id = setInterval(() => {
      const { time, ts, playing } = syncRef.current
      if (!playing) return
      const interpolated = Math.min(time + (performance.now() - ts) / 1000, playerState.duration || 0)
      setDisplayTime(interpolated)
    }, 500)
    return () => clearInterval(id)
  }, [playerState.isPlaying, playerState.duration, seeking])

  // Detect if title overflows its container
  useEffect(() => {
    const inner = titleInnerRef.current
    const wrap  = titleWrapRef.current
    if (!inner || !wrap) return
    setTitleOverflow(inner.scrollWidth > wrap.clientWidth + 2)
  }, [playerState.title])

  useEffect(() => { if (!seeking) setLocalVol(playerState.volume) }, [playerState.volume, seeking])

  const currentTime = seeking ? seekVal : displayTime
  const pct = playerState.duration ? (currentTime / playerState.duration) * 100 : 0

  const commitSeek = useCallback(() => {
    onCommand('SEEK', { time: seekVal })
    setSeeking(false)
  }, [seekVal, onCommand])

  const commitVol = useCallback(() => {
    onCommand('SET_VOLUME', { volume: localVol })
  }, [localVol, onCommand])

  return (
    <div className="rc">

      {/* Now Playing */}
      <div className={`now-playing ${playerState.isPlaying ? 'is-playing' : ''}`}>
        <div className="np-meta">
          {playerState.isPlaying && <span className="np-badge">PLAYING</span>}
          {playerState.title ? (
            <div ref={titleWrapRef} className="np-title-wrap">
              <span
                ref={titleInnerRef}
                className={`np-title${titleOverflow ? ' scrolling' : ''}`}
              >
                {playerState.title}
                {titleOverflow && <>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{playerState.title}</>}
              </span>
            </div>
          ) : (
            <div className="np-empty">No video playing</div>
          )}
          {playerState.channelName && <div className="np-channel">{playerState.channelName}</div>}
        </div>
      </div>

      {/* Seek */}
      <div className="seek-section">
        <input
          type="range"
          className="seek-bar"
          min={0}
          max={playerState.duration || 100}
          step={0.5}
          value={currentTime}
          style={{ '--p': `${pct}%` } as React.CSSProperties}
          onChange={(e) => { setSeeking(true); setSeekVal(+e.target.value) }}
          onMouseUp={commitSeek}
          onTouchEnd={commitSeek}
          disabled={!playerState.duration}
        />
        <div className="time-row">
          <span className="time-val">{fmtTime(currentTime)}</span>
          <span className="time-val">{fmtTime(playerState.duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <button className="ctrl-btn" onClick={() => onCommand('PREVIOUS')} aria-label="Previous">
          <IcPrev />
        </button>
        <button
          className="ctrl-btn play-btn"
          onClick={() => onCommand(playerState.isPlaying ? 'PAUSE' : 'PLAY')}
          aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
        >
          {playerState.isPlaying ? <IcPause /> : <IcPlay />}
        </button>
        <button className="ctrl-btn" onClick={() => onCommand('NEXT')} aria-label="Next">
          <IcNext />
        </button>
      </div>

      {/* Volume */}
      <div className="volume-row">
        <button
          className="vol-btn"
          onClick={() => onCommand(playerState.isMuted ? 'UNMUTE' : 'MUTE')}
          aria-label="Toggle mute"
        >
          <VolIcon v={localVol} muted={playerState.isMuted} />
        </button>
        <input
          type="range"
          className="vol-bar"
          min={0} max={100}
          value={localVol}
          style={{ '--p': `${localVol}%` } as React.CSSProperties}
          onChange={(e) => setLocalVol(+e.target.value)}
          onMouseUp={commitVol}
          onTouchEnd={commitVol}
        />
        <span className="vol-num">{localVol}</span>
      </div>

      {/* Extra */}
      <div className="extra-row">
        <button className="extra-btn" onClick={() => onCommand('FULLSCREEN')}>
          <IcFullscreen />
          Fullscreen
        </button>

        {orderedQualities.length > 0 && (
          <div className="quality-wrap" ref={qualityPickerRef}>
            <button
              className="extra-btn quality-btn"
              onClick={() => setQualityOpen(o => !o)}
              aria-expanded={qualityOpen}
            >
              {qualityLabel(playerState.quality) || 'Quality'}
            </button>
            {qualityOpen && (
              <div className="quality-picker">
                {orderedQualities.map(q => (
                  <button
                    key={q}
                    className={`quality-opt${playerState.quality === q ? ' active' : ''}`}
                    onClick={() => {
                      onCommand('SET_QUALITY', { quality: q })
                      setQualityOpen(false)
                    }}
                  >
                    {qualityLabel(q)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {playerState.title && description && (
        <div className="desc-section">
          <div className="desc-head">
            <span className="desc-title">Description</span>
            {views && <span className="desc-views">{fmtViews(views)}</span>}
          </div>
          <div ref={descRef} className={`desc-text${descExpanded ? '' : ' clamped'}`}>
            {description}
          </div>
          {descOverflow && (
            <button className="desc-toggle" onClick={() => setDescExpanded(e => !e)}>
              {descExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {/* Comments */}
      {playerState.title && (
        <div className="comments-section">
          <div className="comments-head">
            <span className="comments-title">
              <IcComment />
              Comments
            </span>
            <button
              className="comments-refresh"
              onClick={onLoadComments}
              disabled={commentsLoading}
              aria-label="Load comments"
            >
              {commentsLoading ? <span className="cm-spinner" /> : <IcRefresh />}
            </button>
          </div>

          {commentsLoading && comments.length === 0 && (
            <div className="comments-empty">Loading comments…</div>
          )}
          {!commentsLoading && comments.length === 0 && (
            <div className="comments-empty">Tap refresh to load comments.</div>
          )}

          <div className="comments-list">
            {comments.map((c, i) => (
              <div className="comment" key={i}>
                {c.avatar
                  ? <img className="comment-avatar" src={c.avatar} alt="" loading="lazy" />
                  : <div className="comment-avatar comment-avatar-fallback">{(c.author || '?').replace('@','').charAt(0).toUpperCase()}</div>}
                <div className="comment-body">
                  <div className="comment-meta">
                    <span className="comment-author">{c.author}</span>
                    {c.likes && <span className="comment-likes"><IcLike />{c.likes}</span>}
                  </div>
                  <div className="comment-text">{c.text}</div>
                </div>
              </div>
            ))}
            {comments.length > 0 && (
              <div ref={commentsSentinelRef} className="load-more-sentinel">
                {commentsLoadingMore && <span className="cm-spinner" />}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
