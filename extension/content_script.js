let player = null
let stateInterval = null
let lastSentAt = 0
const THROTTLE_MS = 300

function findPlayer() {
  return document.querySelector('video')
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
    channelName: channelEl?.textContent || ''
  }
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

function scrapeSearchResults() {
  const results = []
  const items = document.querySelectorAll('ytd-video-renderer')
  for (let i = 0; i < Math.min(items.length, 10); i++) {
    const el = items[i]
    const titleEl = el.querySelector('#video-title')
    const channelEl = el.querySelector('#channel-name a')
    const thumbEl = el.querySelector('img')
    const durationEl = el.querySelector('span.ytd-thumbnail-overlay-time-status-renderer')
    if (!titleEl) continue
    const videoId = titleEl.getAttribute('href')?.split('v=')[1]?.split('&')[0]
    if (!videoId) continue
    results.push({
      videoId,
      title: titleEl.textContent.trim(),
      channelName: channelEl?.textContent.trim() || '',
      thumbnail: thumbEl?.src || '',
      duration: durationEl?.textContent.trim() || ''
    })
  }
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
    player.addEventListener('loadedmetadata', sendPlayerState)
    setTimeout(sendPlayerState, 500)
    if (stateInterval) clearInterval(stateInterval)
    stateInterval = setInterval(sendPlayerState, 2000)
  } else {
    setTimeout(init, 2000)
  }

  if (location.href.includes('/results?search_query=')) {
    setTimeout(scrapeSearchResults, 3000)
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') { sendResponse({ ok: true }); return true }
  if (message.type !== 'COMMAND') return

  const { action, payload } = message

  if (!player) { player = findPlayer() }
  if (!player && action !== 'SEARCH' && action !== 'PLAY_VIDEO') {
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
    case 'GET_STATE':
      sendPlayerState()
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
