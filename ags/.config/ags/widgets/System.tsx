import { Astal, Gdk } from "ags/gtk3"
import { exec, execAsync } from "ags/process"
import { createPoll } from "ags/time"
import { createState } from "ags"
import { layoutName, multiLayout } from "./NiriEvents"
import { toggleSidebar } from "./Sidebar"

// ── Volume ──────────────────────────────────────────────────────────────────

function getVolumeState(): [number, boolean] {
    try {
        const out = exec("wpctl get-volume @DEFAULT_AUDIO_SINK@")
        const muted = out.includes("[MUTED]")
        const match = out.match(/Volume:\s+([\d.]+)/)
        const vol = match ? Math.round(parseFloat(match[1]) * 100) : 0
        return [vol, muted]
    } catch {
        return [0, false]
    }
}

const [initVol, initMuted] = getVolumeState()
// Combined state so icon/label react to both volume AND mute changes
const [volState, setVolState] = createState({ vol: initVol, muted: initMuted })

const volIconName = volState((s) => {
    if (s.muted || s.vol === 0) return "audio-volume-muted-symbolic"
    if (s.vol > 66) return "audio-volume-high-symbolic"
    if (s.vol > 33) return "audio-volume-medium-symbolic"
    return "audio-volume-low-symbolic"
})

const volLabel = volState((s) => {
    if (s.muted) return "Muted"
    return `${s.vol}%`
})

function refreshVolume() {
    const [v, m] = getVolumeState()
    setVolState({ vol: v, muted: m })
}

createPoll(0, 2000, refreshVolume)

function changeVolume(delta: string) {
    execAsync(["bash", "-c", `wpctl set-volume -l 1.0 @DEFAULT_AUDIO_SINK@ ${delta}`])
        .then(refreshVolume)
        .catch(() => {})
}

function toggleMute() {
    execAsync(["bash", "-c", "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"])
        .then(refreshVolume)
        .catch(() => {})
}

// ── CPU ──────────────────────────────────────────────────────────────────────

function getCpu(): string {
    try {
        const out = exec(["bash", "-c",
            "awk '/^cpu /{u=$2+$4; t=$2+$3+$4+$5+$6+$7+$8; print u, t}' /proc/stat"])
        const [u, t] = out.trim().split(" ").map(Number)
        return `${u}:${t}`
    } catch { return "0:0" }
}

let prevCpu = getCpu()

const cpuLabel = createPoll("0%", 2000, () => {
    const cur = getCpu()
    const [pu, pt] = prevCpu.split(":").map(Number)
    const [cu, ct] = cur.split(":").map(Number)
    const pct = ct - pt > 0 ? Math.round(((cu - pu) / (ct - pt)) * 100) : 0
    prevCpu = cur
    return `${pct}%`
})

// ── RAM ──────────────────────────────────────────────────────────────────────

const ramLabel = createPoll("0%", 3000, () => {
    try {
        const out = exec(["bash", "-c",
            "awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{printf \"%d\", (t-a)/t*100}' /proc/meminfo"])
        return `${out}%`
    } catch { return "0%" }
})

// ── Network ─────────────────────────────────────────────────────────────────

function getNetwork(): string {
    try {
        // Try nmcli first (if NetworkManager is available)
        try {
            const out = exec("nmcli -t -f TYPE,STATE,CONNECTION device")
            for (const line of out.split("\n")) {
                const [type, state] = line.split(":")
                if (state === "connected") {
                    if (type === "wifi") return "network-wireless-symbolic"
                    if (type === "ethernet") return "network-wired-symbolic"
                }
            }
            return "network-offline-symbolic"
        } catch {}
        // Fallback: check ip link for any UP interface with an IP
        const links = exec(["bash", "-c",
            "ip -o link show up | awk -F': ' '{print $2}' | grep -v '^lo$'"])
        if (links.trim()) {
            const iface = links.trim().split("\n")[0]
            const hasIp = exec(["bash", "-c", `ip -o addr show ${iface} | grep 'inet '`]).trim()
            if (hasIp) {
                if (iface.startsWith("wl")) return "network-wireless-symbolic"
                return "network-wired-symbolic"
            }
        }
        return "network-offline-symbolic"
    } catch {
        return "network-offline-symbolic"
    }
}

const netIcon = createPoll(getNetwork(), 5000, getNetwork)

// ── Widget ──────────────────────────────────────────────────────────────────

export default function System() {
    return (
        <box class="island system" spacing={6}>
            {multiLayout && (
                <box class="sys-btn">
                    <label class="kbd-label" label={layoutName} />
                </box>
            )}
            <box class="sys-btn" spacing={6}>
                <label class="sys-icon-text" label="󰙴" />
                <label class="sys-label" label={cpuLabel} />
            </box>
            <box class="sys-btn" spacing={6}>
                <label class="sys-icon-text" label="󰍛" />
                <label class="sys-label" label={ramLabel} />
            </box>
            <eventbox
                onClick={toggleMute}
                onScroll={(_self: Astal.EventBox, event: { direction: Gdk.ScrollDirection; delta_y: number }) => {
                    if (event.direction === Gdk.ScrollDirection.UP) {
                        changeVolume("5%+")
                    } else if (event.direction === Gdk.ScrollDirection.DOWN) {
                        changeVolume("5%-")
                    } else if (event.direction === Gdk.ScrollDirection.SMOOTH) {
                        if (event.delta_y < 0) changeVolume("2%+")
                        else if (event.delta_y > 0) changeVolume("2%-")
                    }
                }}
            >
                <box class="sys-btn" spacing={6}>
                    <icon class="sys-icon" icon={volIconName} />
                    <label class="sys-label" label={volLabel} />
                </box>
            </eventbox>
            <box class="sys-btn" spacing={6}>
                <icon class="sys-icon" icon={netIcon} />
            </box>
            <eventbox onClick={toggleSidebar}>
                <box class="sys-btn">
                    <icon class="sys-icon" icon="view-more-symbolic" />
                </box>
            </eventbox>
        </box>
    )
}
