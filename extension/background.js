const BINARY_URL = 'http://localhost:7331'
const WS_URL = 'ws://localhost:7331/ws'

let ws = null
let token = null
let connected = false
let extensionConnected = false
let reconnectTimer = null
let youtubeTabId = null

async function fetchToken() {
  try {
    const res = await fetch(`${BINARY_URL}/api/status`, { signal: AbortSignal.timeout(3000) })
    const data = await res.json()
    return data.token || null
  } catch {
    return null
  }
}

async function connect() {
  // Prevent double-connect
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  if (!token) token = await fetchToken()
  if (!token) { scheduleReconnect(); return }

  // Use local ref so closures always talk to THIS socket, not a later reassignment
  const socket = new WebSocket(WS_URL)
  ws = socket

  socket.onopen = () => {
    // Guard: if ws was replaced while we were connecting, close this orphan
    if (ws !== socket) { socket.close(); return }
    socket.send(JSON.stringify({ deviceType: 'extension', token }))
    connected = true
    notifyPopup({ type: 'STATUS', connected: true, extensionConnected })
  }

  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'COMMAND') {
        handleCommand(msg)
      } else if (msg.type === 'PEER_CONNECTED') {
        extensionConnected = true
        notifyPopup({ type: 'STATUS', connected: true, extensionConnected: true })
        pushStateToRemote()
      } else if (msg.type === 'PEER_DISCONNECTED') {
        extensionConnected = false
        notifyPopup({ type: 'STATUS', connected: true, extensionConnected: false })
      } else if (msg.type === 'ERROR') {
        token = null
        socket.close()
      }
    } catch {}
  }

  socket.onclose = () => {
    if (ws !== socket) return  // already replaced, ignore
    connected = false
    extensionConnected = false
    notifyPopup({ type: 'STATUS', connected: false, extensionConnected: false })
    scheduleReconnect()
  }

  socket.onerror = () => socket.close()
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connect, 3000)
}

async function ensureContentScript(tabId) {
  try {
    // Ping the content script; if it replies, it's alive
    await chrome.tabs.sendMessage(tabId, { type: 'PING' })
  } catch {
    // Not injected — inject now
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content_script.js'] })
  }
}

async function handleGetQualities(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const mp = document.getElementById('movie_player')
        return {
          quality: mp?.getPlaybackQuality?.() || '',
          availableQualities: mp?.getAvailableQualityLevels?.() || []
        }
      }
    })
    if (res?.result && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'EVENT', action: 'QUALITY_INFO', ...res.result }))
    }
  } catch {}
}

async function handleSetQuality(tabId, quality) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (q) => {
        const mp = document.getElementById('movie_player')
        if (mp?.setPlaybackQualityRange) mp.setPlaybackQualityRange(q, q)
        else if (mp?.setPlaybackQuality) mp.setPlaybackQuality(q)
      },
      args: [quality]
    })
    setTimeout(() => handleGetQualities(tabId), 600)
  } catch {}
}

async function handleCommand(msg) {
  const { action, payload } = msg
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' })
  if (tabs.length === 0) return

  const tab = tabs[0]
  youtubeTabId = tab.id

  if (action === 'FULLSCREEN') {
    await handleFullscreen(tab.id)
    return
  }

  if (action === 'SET_QUALITY') {
    await handleSetQuality(tab.id, payload?.quality)
    return
  }

  await ensureContentScript(tab.id)

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', action, payload })
  } catch (err) {
    console.error('[TubeRemote] sendMessage error:', err.message)
  }
}

async function handleFullscreen(tabId) {
  // Exit fullscreen doesn't need a user gesture — handle it directly
  const [{ result: isFs }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => !!document.fullscreenElement
  }).catch(() => [[{ result: false }]])

  if (isFs) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => document.exitFullscreen()
    }).catch(() => {})
    return
  }

  // Enter fullscreen: dispatch a real 'f' keydown via CDP.
  // CDP input events are trusted (same as physical keyboard) so requestFullscreen works.
  // The "DevTools debugging" banner flashes briefly then disappears on detach.
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'f', code: 'KeyF',
      windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70
    })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'f', code: 'KeyF',
      windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70
    })
    await new Promise(r => setTimeout(r, 50))
    await chrome.debugger.detach({ tabId })
  } catch (e) {
    console.error('[TubeRemote] fullscreen CDP error:', e)
    try { await chrome.debugger.detach({ tabId }) } catch {}
  }
}

async function pushStateToRemote() {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' })
  if (tabs.length === 0) return
  try {
    await ensureContentScript(tabs[0].id)
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'COMMAND', action: 'GET_STATE', payload: {} })
  } catch {}
}

function notifyPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {})
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ connected, extensionConnected, token })
    return true
  }

  if (message.type === 'EVENT') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'EVENT', action: message.data.action, ...message.data }))
    }
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'FETCH_QUALITY') {
    chrome.tabs.query({ url: 'https://www.youtube.com/*' }).then(tabs => {
      if (tabs.length > 0) handleGetQualities(tabs[0].id)
    })
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'RECONNECT') {
    token = null
    if (ws) ws.close()
    connect()
    sendResponse({ ok: true })
    return true
  }

  return true
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === youtubeTabId) youtubeTabId = null
})

chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
connect()
