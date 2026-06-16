let player = null
let attachedPlayer = null
let lastSentAt = 0
let throttleTimer = null
let playbackSync = null
const THROTTLE_MS = 300
const PLAYBACK_SYNC_MS = 2000
let sentHomeVideoIds = new Set()
let sentSearchVideoIds = new Set()
let currentQuality = ''
let availableQualities = []
let playerObserver = null

function findPlayer() {
  return document.querySelector('video')
}

// Channel name lives in different elements across YouTube layouts — try them all.
function extractChannelName(el) {
  const c = el.querySelector(
    'ytd-channel-name #text-container yt-formatted-string, ' +
    'ytd-channel-name #text, ytd-channel-name a, ' +
    '#channel-name a, #channel-name #text, ' +
    'yt-formatted-string.ytd-channel-name, .yt-content-metadata-view-model-wiz__metadata-text'
  )
  const name = c?.textContent?.trim()
  if (name) return name
  // Last resort: any link that points to a channel — its text is the channel name.
  const link = el.querySelector('a[href^="/@"], a[href*="/channel/"], a[href*="/c/"], a[href*="/user/"]')
  return link?.textContent?.trim() || ''
}

function isExtensionValid() {
  try { return chrome.runtime?.id !== undefined } catch { return false }
}

function getPlayerState() {
  if (!player) { player = findPlayer(); if (!player) return null }

  const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string')
  const channelEl = document.querySelector('ytd-channel-name a, #channel-name a')

  if (!titleEl?.textContent || player.duration < 1 || isNaN(player.duration)) return null

  return {
    isPlaying: !player.paused,
    currentTime: player.currentTime,
    duration: player.duration,
    volume: Math.round(player.volume * 100),
    isMuted: player.muted,
    title: titleEl.textContent,
    channelName: channelEl?.textContent || '',
    videoId: new URLSearchParams(location.search).get('v') || '',
    quality: currentQuality,
    availableQualities: availableQualities
  }
}

function fetchQualityInfo() {
  // Quality fetch runs in MAIN world via background to bypass CSP
  if (isExtensionValid()) {
    chrome.runtime.sendMessage({ type: 'FETCH_QUALITY' }).catch(() => {})
  }
}

function readYtInitialData() {
  for (const script of document.querySelectorAll('script:not([src])')) {
    const t = script.textContent || ''
    const marker = 'var ytInitialData = '
    const idx = t.indexOf(marker)
    if (idx === -1) continue
    const start = idx + marker.length
    if (t[start] !== '{') continue
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < t.length; i++) {
      const c = t[i]
      if (esc) { esc = false; continue }
      if (c === '\\' && inStr) { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)) } catch {}
        break
      }
    }
  }
  return null
}

// Throttled, trailing-edge state push. Discrete player events (play/pause/seek/
// volume/rate/etc.) drive this — there is no periodic poll, so the trailing send
// guarantees the final value of a burst (e.g. a volume drag) still reaches the remote.
function sendPlayerState() {
  if (!isExtensionValid()) return
  const now = Date.now()
  const elapsed = now - lastSentAt
  if (elapsed < THROTTLE_MS) {
    if (!throttleTimer) {
      throttleTimer = setTimeout(() => { throttleTimer = null; sendPlayerState() }, THROTTLE_MS - elapsed)
    }
    return
  }
  const state = getPlayerState()
  if (!state) return
  lastSentAt = now
  chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'PLAYER_STATE', state } }).catch(() => {})
}

// A smooth seek bar can't be purely event-driven: the browser emits no event
// when playback time drifts (buffering, ads, non-1x speed), so the remote's
// local interpolation slowly desyncs. Correct it with a position resync that
// runs ONLY while playing — paused/idle/browsing stays silent (no polling).
function startPlaybackSync() {
  if (playbackSync) return
  playbackSync = setInterval(sendPlayerState, PLAYBACK_SYNC_MS)
}

function stopPlaybackSync() {
  if (playbackSync) { clearInterval(playbackSync); playbackSync = null }
}

function onPlay()  { startPlaybackSync(); sendPlayerState() }
function onPause() { stopPlaybackSync(); sendPlayerState() }
function onEnded() { stopPlaybackSync(); sendPlayerState() }

function parseHomeFromInitialData(data) {
  const results = []
  try {
    const tab = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
    const items = tab?.content?.richGridRenderer?.contents || []
    for (const item of items) {
      if (results.length >= 20) break
      const vr = item?.richItemRenderer?.content?.videoRenderer
      if (!vr?.videoId) continue
      const thumbs = vr.thumbnail?.thumbnails || []
      results.push({
        videoId: vr.videoId,
        title: vr.title?.runs?.[0]?.text || '',
        channelName: vr.shortBylineText?.runs?.[0]?.text
          || vr.ownerText?.runs?.[0]?.text
          || vr.longBylineText?.runs?.[0]?.text || '',
        thumbnail: thumbs[thumbs.length - 1]?.url
          || `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
        duration: vr.lengthText?.simpleText || ''
      })
    }
  } catch {}
  return results
}

// Scrape home-grid video items from the DOM, skipping any IDs already in `skip`
// (and adding new ones to it). Shared by the initial scrape and SCROLL_HOME.
function scrapeHomeDom(skip) {
  const results = []
  document.querySelectorAll('ytd-rich-item-renderer a[href*="/watch?v="]').forEach(a => {
    if (results.length >= 20) return
    const videoId = new URLSearchParams(a.search).get('v')
    if (!videoId || skip.has(videoId)) return
    skip.add(videoId)
    const item = a.closest('ytd-rich-item-renderer')
    const imgSrc = item?.querySelector('img[src*="ytimg"], img')?.src
    results.push({
      videoId,
      title: (item?.querySelector('#video-title-link, #video-title, h3 a') || a).textContent?.trim() || '',
      channelName: item ? extractChannelName(item) : '',
      thumbnail: imgSrc && imgSrc.includes('ytimg') ? imgSrc : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      duration: item?.querySelector('.ytd-thumbnail-overlay-time-status-renderer')?.textContent?.trim() || ''
    })
  })
  return results
}

// Wait (event-driven) until `check()` returns a truthy value, then call onReady.
// Replaces fixed-delay/retry polling: a MutationObserver fires as the page renders,
// with a timeout as the final fallback. `check` must return null until ready.
function waitForContent(check, onReady, timeout = 12000) {
  const immediate = check()
  if (immediate) { onReady(immediate); return }

  let settled = false
  let obs = null
  let timer = null
  const finish = (r) => {
    if (settled) return
    settled = true
    if (obs) obs.disconnect()
    if (timer) clearTimeout(timer)
    onReady(r)
  }
  obs = new MutationObserver(() => { const r = check(); if (r) finish(r) })
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true })
  timer = setTimeout(() => finish(check()), timeout)
}

function scrapeHomeVideos() {
  waitForContent(
    () => {
      // Primary: ytInitialData from existing script tags — no injection, no CSP issues
      const data = readYtInitialData()
      const yt = data ? parseHomeFromInitialData(data) : []
      if (yt.length > 0) return yt
      // Fallback: DOM scraping
      const dom = scrapeHomeDom(new Set())
      return dom.length > 0 ? dom : null
    },
    (results) => {
      const list = results || []
      list.forEach(r => sentHomeVideoIds.add(r.videoId))
      if (isExtensionValid()) {
        chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'HOME_RESULTS', results: list } }).catch(() => {})
      }
    }
  )
}

// Scrape search-result video items, skipping any IDs already in `skip` (and adding new ones to it).
function scrapeSearchItems(skip) {
  const results = []
  const items = document.querySelectorAll('ytd-video-renderer')
  for (const el of items) {
    if (results.length >= 20) break
    const titleEl = el.querySelector('#video-title')
    if (!titleEl) continue
    const videoId = titleEl.getAttribute('href')?.split('v=')[1]?.split('&')[0]
    if (!videoId || skip.has(videoId)) continue
    skip.add(videoId)
    const thumbEl = el.querySelector('img')
    const durationEl = el.querySelector('span.ytd-thumbnail-overlay-time-status-renderer, .badge-shape-wiz__text')
    results.push({
      videoId,
      title: titleEl.textContent.trim(),
      channelName: extractChannelName(el),
      thumbnail: thumbEl?.src || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      duration: durationEl?.textContent.trim() || ''
    })
  }
  return results
}

function scrapeSearchResults() {
  sentSearchVideoIds = new Set()
  waitForContent(
    () => {
      const r = scrapeSearchItems(sentSearchVideoIds)
      return r.length > 0 ? r : null
    },
    (results) => {
      if (isExtensionValid()) {
        chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'SEARCH_RESULTS', results: results || [] } }).catch(() => {})
      }
    }
  )
}

function onLoadedMetadata() {
  sendPlayerState()
  setTimeout(fetchQualityInfo, 1500)
  if (player && !player.paused) startPlaybackSync()
}

// Attach discrete player-event listeners once per <video> element. Idempotent:
// re-attaching to the same element (e.g. across SPA navigation, where YouTube
// reuses the element) is a no-op, so no duplicate listeners accumulate.
function attachPlayer() {
  const el = findPlayer()
  if (!el) return false
  player = el
  if (el === attachedPlayer) return true
  attachedPlayer = el
  el.addEventListener('play', onPlay)
  el.addEventListener('pause', onPause)
  el.addEventListener('ended', onEnded)
  el.addEventListener('volumechange', sendPlayerState)
  el.addEventListener('seeked', sendPlayerState)
  el.addEventListener('ratechange', sendPlayerState)
  el.addEventListener('durationchange', sendPlayerState)
  el.addEventListener('loadedmetadata', onLoadedMetadata)
  if (!el.paused) startPlaybackSync()
  return true
}

// Ensure we're attached to the player. If it isn't in the DOM yet (watch page
// still rendering), wait for it via MutationObserver instead of polling on a timer.
function ensurePlayer() {
  if (attachPlayer()) return
  if (!location.pathname.startsWith('/watch')) return  // no <video> off the watch page
  if (playerObserver) return

  const stop = () => { if (playerObserver) { playerObserver.disconnect(); playerObserver = null } }
  playerObserver = new MutationObserver(() => {
    if (attachPlayer()) { stop(); sendPlayerState() }
  })
  playerObserver.observe(document.body || document.documentElement, { childList: true, subtree: true })
  setTimeout(stop, 15000)  // safety cap: don't observe forever if the player never shows
}

function handlePageScrape() {
  if (location.href.includes('/results?search_query=')) scrapeSearchResults()
  else if (location.pathname === '/') scrapeHomeVideos()
}

// Single entry point for both first load and SPA navigation (yt-navigate-finish).
function init() {
  ensurePlayer()
  setTimeout(sendPlayerState, 500)  // let title/metadata settle, then resync
  handlePageScrape()
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') { sendResponse({ ok: true }); return true }
  if (message.type !== 'COMMAND') return

  const { action, payload } = message

  if (!player) { player = findPlayer() }
  const noPlayerOk = ['SEARCH', 'PLAY_VIDEO', 'GET_HOME_VIDEOS', 'SCROLL_HOME', 'SCROLL_SEARCH']
  if (!player && !noPlayerOk.includes(action)) {
    sendResponse({ error: 'player not found' })
    return
  }

  switch (action) {
    case 'PLAY':       player.play(); break
    case 'PAUSE':      player.pause(); break
    case 'MUTE':       player.muted = true; break
    case 'UNMUTE':     player.muted = false; break
    case 'SET_VOLUME':
      if (payload?.volume != null) player.volume = Math.max(0, Math.min(1, payload.volume / 100))
      break
    case 'SEEK':
      if (payload?.time != null) player.currentTime = payload.time
      break
    case 'NEXT':
      document.querySelector('.ytp-next-button')?.click()
      break
    case 'PREVIOUS':
      if (player) player.currentTime = 0
      break
    case 'FULLSCREEN': {
      const mp = document.getElementById('movie_player')
      const isFs = !!document.fullscreenElement

      if (isFs) {
        // exit always works without user gesture
        document.exitFullscreen().catch(() => {})
        break
      }

      // YouTube's own internal API — no user gesture required
      if (typeof mp?.setFullscreen === 'function') {
        mp.setFullscreen(true)
      } else if (typeof mp?.toggleFullscreen === 'function') {
        mp.toggleFullscreen()
      } else {
        // Simulate keyboard 'f' — YouTube handles it internally
        document.querySelector('#movie_player')?.focus()
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'f', code: 'KeyF', keyCode: 70, bubbles: true
        }))
      }
      break
    }
    case 'SEARCH':
      if (payload?.query) location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(payload.query)}`
      break
    case 'PLAY_VIDEO':
      if (payload?.videoId) location.href = `https://www.youtube.com/watch?v=${payload.videoId}`
      break
    case 'GET_HOME_VIDEOS':
      sentHomeVideoIds = new Set()
      if (location.pathname === '/') {
        scrapeHomeVideos()
      } else {
        location.href = 'https://www.youtube.com'
      }
      break
    case 'SCROLL_HOME':
      if (location.pathname === '/') {
        window.scrollBy(0, window.innerHeight * 2)
        setTimeout(() => {
          const newResults = scrapeHomeDom(sentHomeVideoIds)
          if (isExtensionValid() && newResults.length > 0) {
            chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'HOME_MORE_RESULTS', results: newResults } }).catch(() => {})
          }
        }, 2000)
      }
      break
    case 'SCROLL_SEARCH':
      if (location.href.includes('/results?search_query=')) {
        window.scrollBy(0, window.innerHeight * 2)
        setTimeout(() => {
          const newResults = scrapeSearchItems(sentSearchVideoIds)
          if (isExtensionValid() && newResults.length > 0) {
            chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'SEARCH_MORE_RESULTS', results: newResults } }).catch(() => {})
          }
        }, 2000)
      }
      break
    // SET_QUALITY is handled by background.js via chrome.scripting (MAIN world) to bypass CSP
    case 'GET_STATE':
      sendPlayerState()
      fetchQualityInfo()
      break
  }

  sendResponse({ ok: true })
  setTimeout(sendPlayerState, 200)
})

// YouTube is a SPA: most navigation fires yt-navigate-finish instead of a full
// page load. Re-run init so we re-attach to the new video and refresh state/results.
document.addEventListener('yt-navigate-finish', init)

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
