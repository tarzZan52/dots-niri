import { Gtk } from "ags/gtk3"
import { createState } from "ags"
import { exec, execAsync } from "ags/process"
import { timeout } from "ags/time"
import GLib from "gi://GLib"

export interface PlayerInfo {
    artist: string
    title: string
    playing: boolean
    artUrl: string | null
}

export function findMprisPlayer(): string | null {
    try {
        const out = exec(["bash", "-c",
            "busctl --user list --no-pager | grep org.mpris.MediaPlayer2 | grep -v firefox | awk '{print $1}' | head -1"])
        return out.trim() || null
    } catch {
        return null
    }
}

function getPlayer(): PlayerInfo | null {
    const bus = findMprisPlayer()
    if (!bus) return null

    try {
        const statusRaw = exec(["busctl", "--user", "get-property", bus,
            "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "PlaybackStatus"])
        const status = statusRaw.replace(/^s "/, "").replace(/"$/, "").trim()
        if (status !== "Playing" && status !== "Paused") return null

        const metaRaw = exec(["busctl", "--user", "get-property", bus,
            "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "Metadata"])

        const titleMatch = metaRaw.match(/"xesam:title"\s+s\s+"([^"]*)"/)
        const artistMatch = metaRaw.match(/"xesam:artist"\s+as\s+\d+\s+"([^"]*)"/)
        const artMatch = metaRaw.match(/"mpris:artUrl"\s+s\s+"([^"]*)"/)

        const title = titleMatch ? titleMatch[1] : ""
        const artist = artistMatch ? artistMatch[1] : ""
        const artUrl = artMatch ? artMatch[1] : null

        if (!title) return null
        return { artist, title, playing: status === "Playing", artUrl }
    } catch {
        return null
    }
}

export const [player, setPlayer] = createState(getPlayer())
export const [artPath, setArtPath] = createState<string | null>(null)

const playerIcon = player((p) => {
    if (!p) return ""
    return p.playing ? "" : ""
})

const playerText = player((p) => {
    if (!p) return ""
    if (p.artist) return `${p.artist} — ${p.title}`
    return p.title
})

export const hasPlayer = player((p) => p !== null)

// Art download
let lastArtUrl = ""
let artCounter = 0

function downloadArt(url: string) {
    if (url.startsWith("http")) {
        try {
            artCounter = (artCounter + 1) % 2
            const dest = `/tmp/ags-player-art-${artCounter}`
            exec(["curl", "-sL", "-o", dest, url])
            setArtPath(dest)
        } catch {
            setArtPath(null)
        }
    } else {
        setArtPath(url.replace("file://", ""))
    }
}

function refresh() {
    const info = getPlayer()
    setPlayer(info)

    if (info?.artUrl && info.artUrl !== lastArtUrl) {
        lastArtUrl = info.artUrl
        downloadArt(info.artUrl)
    }
    if (!info) {
        lastArtUrl = ""
        setArtPath(null)
    }
}

// Listen for MPRIS PropertiesChanged via dbus-monitor (instant updates)
import { subprocess } from "ags/process"

let debounceTimer: any = null

subprocess(
    ["bash", "-c",
     "dbus-monitor --session \"type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',path='/org/mpris/MediaPlayer2'\" 2>/dev/null | grep --line-buffered 'PropertiesChanged'"],
    () => {
        // Debounce: multiple signals fire at once on track change
        if (debounceTimer) return
        debounceTimer = timeout(300, () => {
            debounceTimer = null
            refresh()
        })
    },
)

// Slow fallback poll every 5s (in case dbus-monitor misses something)
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
    refresh()
    return true
})

// Initial
refresh()

export function togglePlayPause() {
    const bus = findMprisPlayer()
    if (!bus) return
    const current = player.get()
    const method = current?.playing ? "Pause" : "Play"
    execAsync(["busctl", "--user", "call", bus,
        "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", method, ""])
        .then(() => timeout(300, refresh))
        .catch(() => {})
}

export function prevTrack() {
    const bus = findMprisPlayer()
    if (!bus) return
    execAsync(["busctl", "--user", "call", bus,
        "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "Previous", ""])
        .then(() => {
            // spotify_player takes ~1s to update metadata
            timeout(1000, refresh)
        })
        .catch(() => {})
}

export function nextTrack() {
    const bus = findMprisPlayer()
    if (!bus) return
    execAsync(["busctl", "--user", "call", bus,
        "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "Next", ""])
        .then(() => {
            timeout(1000, refresh)
        })
        .catch(() => {})
}

// Popup visibility — two-state pattern like sidebar
const POPUP_TRANSITION_MS = 250
const [popupVisible, setPopupVisible] = createState(false)
const [popupOpen, setPopupOpen] = createState(false)

export const popupVis = popupVisible
export const popupRevealed = popupOpen

export function togglePlayerPopup() {
    const opening = !popupOpen.get()
    if (opening) {
        setPopupVisible(true)
        timeout(10, () => setPopupOpen(true))
    } else {
        setPopupOpen(false)
        timeout(POPUP_TRANSITION_MS, () => setPopupVisible(false))
    }
}

export default function Player() {
    return (
        <eventbox
            visible={hasPlayer}
            onClick={togglePlayerPopup}
        >
            <box class="island player" spacing={8}>
                <label class="player-icon" label={playerIcon} />
                <label
                    class="player-text"
                    label={playerText}
                    maxWidthChars={35}
                    ellipsize={3}
                />
            </box>
        </eventbox>
    )
}
