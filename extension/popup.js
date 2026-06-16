const BINARY_URL = 'http://localhost:7331'

const binaryDot   = document.getElementById('binary-dot')
const binaryLabel = document.getElementById('binary-label')
const phoneDot    = document.getElementById('phone-dot')
const phoneLabel  = document.getElementById('phone-label')
const qrSection   = document.getElementById('qr-section')
const offSection  = document.getElementById('offline-section')
const qrImg       = document.getElementById('qr-img')
const phonePill   = document.getElementById('phone-pill')
const pillDot     = document.getElementById('pill-dot')
const pillLabel   = document.getElementById('pill-label')

function showOnline(remoteConnected) {
  binaryDot.className = 'dot on'
  binaryLabel.textContent = 'Binary'
  qrSection.style.display = 'flex'
  offSection.style.display = 'none'

  if (remoteConnected) {
    phoneDot.className = 'dot on'
    phoneLabel.textContent = 'Phone'
    phonePill.className = 'phone-pill connected'
    pillDot.className = 'dot on'
    pillLabel.textContent = 'Phone connected'
  } else {
    phoneDot.className = 'dot'
    phoneLabel.textContent = 'Phone'
    phonePill.className = 'phone-pill'
    pillDot.className = 'dot'
    pillLabel.textContent = 'Phone not connected'
  }
}

function showOffline() {
  binaryDot.className = 'dot red'
  binaryLabel.textContent = 'Offline'
  phoneDot.className = 'dot'
  phoneLabel.textContent = 'Phone'
  qrSection.style.display = 'none'
  offSection.style.display = 'flex'
}

async function load() {
  try {
    const res = await fetch(`${BINARY_URL}/api/status`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error()
    const data = await res.json()
    showOnline(data.remoteConnected)
    qrImg.src = `${BINARY_URL}/api/qr?t=${Date.now()}`
  } catch {
    showOffline()
  }
}

function retry() {
  chrome.runtime.sendMessage({ type: 'RECONNECT' })
  load()
}

// live updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS') {
    if (msg.connected) showOnline(msg.extensionConnected)
    else showOffline()
  }
})

load()
