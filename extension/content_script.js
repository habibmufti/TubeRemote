let player = null
let stateInterval = null
let lastSentAt = 0
const THROTTLE_MS = 300
let homeScrapePending = false
let searchScrapePending = false
let sentHomeVideoIds = new Set()
let sentSearchVideoIds = new Set()
let currentQuality = ''
let availableQualities = []

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
  return c?.textContent?.trim() || ''
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

function sendPlayerState() {
  if (!isExtensionValid()) return
  const now = Date.now()
  if (now - lastSentAt < THROTTLE_MS) return
  const state = getPlayerState()
  if (!state) return
  lastSentAt = now
  chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'PLAYER_STATE', state } }).catch(() => {})
}

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

function scrapeHomeVideos(retries = 0) {
  homeScrapePending = false

  function finish(results) {
    if (results.length === 0 && retries < 8) {
      homeScrapePending = true
      setTimeout(() => scrapeHomeVideos(retries + 1), 1500)
      return
    }
    results.forEach(r => sentHomeVideoIds.add(r.videoId))
    if (isExtensionValid()) {
      chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'HOME_RESULTS', results } }).catch(() => {})
    }
  }

  // Primary: read ytInitialData from existing script tags — no injection, no CSP issues
  const data = readYtInitialData()
  const ytResults = data ? parseHomeFromInitialData(data) : []
  if (ytResults.length > 0) {
    finish(ytResults)
    return
  }

  // Fallback: DOM scraping
  const domResults = []
  const seen = new Set()
  document.querySelectorAll('ytd-rich-item-renderer a[href*="/watch?v="]').forEach(a => {
    if (domResults.length >= 20) return
    const videoId = new URLSearchParams(a.search).get('v')
    if (!videoId || seen.has(videoId)) return
    seen.add(videoId)
    const item = a.closest('ytd-rich-item-renderer')
    const imgSrc = item?.querySelector('img[src*="ytimg"], img')?.src
    domResults.push({
      videoId,
      title: (item?.querySelector('#video-title-link, #video-title, h3 a') || a).textContent?.trim() || '',
      channelName: item ? extractChannelName(item) : '',
      thumbnail: imgSrc && imgSrc.includes('ytimg') ? imgSrc : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      duration: item?.querySelector('.ytd-thumbnail-overlay-time-status-renderer')?.textContent?.trim() || ''
    })
  })
  finish(domResults)
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
  searchScrapePending = false
  sentSearchVideoIds = new Set()
  const results = scrapeSearchItems(sentSearchVideoIds)
  if (isExtensionValid()) {
    chrome.runtime.sendMessage({ type: 'EVENT', data: { action: 'SEARCH_RESULTS', results } }).catch(() => {})
  }
}

function init() {
  player = findPlayer()
  if (player) {
    player.addEventListener('play', sendPlayerState)
    player.addEventListener('pause', sendPlayerState)
    player.addEventListener('volumechange', sendPlayerState)
    player.addEventListener('loadedmetadata', () => { sendPlayerState(); setTimeout(fetchQualityInfo, 1500) })
    setTimeout(sendPlayerState, 500)
    if (stateInterval) clearInterval(stateInterval)
    stateInterval = setInterval(sendPlayerState, 2000)
  } else {
    setTimeout(init, 2000)
  }

  if (location.href.includes('/results?search_query=') && !searchScrapePending) {
    searchScrapePending = true
    setTimeout(scrapeSearchResults, 3000)
  }

  if (location.pathname === '/' && !homeScrapePending) {
    homeScrapePending = true
    setTimeout(scrapeHomeVideos, 3000)
  }
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
          const newResults = []
          const seen = new Set(sentHomeVideoIds)
          document.querySelectorAll('ytd-rich-item-renderer a[href*="/watch?v="]').forEach(a => {
            if (newResults.length >= 20) return
            const videoId = new URLSearchParams(a.search).get('v')
            if (!videoId || seen.has(videoId)) return
            seen.add(videoId)
            sentHomeVideoIds.add(videoId)
            const item = a.closest('ytd-rich-item-renderer')
            const imgSrc = item?.querySelector('img[src*="ytimg"], img')?.src
            newResults.push({
              videoId,
              title: (item?.querySelector('#video-title-link, #video-title, h3 a') || a).textContent?.trim() || '',
              channelName: item ? extractChannelName(item) : '',
              thumbnail: imgSrc && imgSrc.includes('ytimg') ? imgSrc : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
              duration: item?.querySelector('.ytd-thumbnail-overlay-time-status-renderer')?.textContent?.trim() || ''
            })
          })
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
