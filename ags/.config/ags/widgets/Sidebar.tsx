import { Astal, Gtk } from "ags/gtk3"
import { createState, For, onCleanup } from "ags"
import { exec, execAsync } from "ags/process"
import { createPoll } from "ags/time"
import { timeout } from "ags/time"
import app from "ags/gtk3/app"
import AstalNotifd from "gi://AstalNotifd"
import GLib from "gi://GLib"
import { resolveIcon } from "./Notifications"
import {
    player,
    artPath,
    hasPlayer,
    togglePlayPause,
    prevTrack,
    nextTrack,
} from "./Player"

// ── Date ─────────────────────────────────────────────────────────────────────

const fullDate = createPoll("", 60_000, () => {
    try {
        const dt = GLib.DateTime.new_now_local()
        return dt ? (dt.format("%A, %d %B %Y") || "") : ""
    } catch {
        return ""
    }
})

const fullTime = createPoll("--:--", 1000, () => {
    try {
        const dt = GLib.DateTime.new_now_local()
        return dt ? (dt.format("%H:%M:%S") || "--:--") : "--:--"
    } catch {
        return "--:--"
    }
})

// ── Notifications ────────────────────────────────────────────────────────────

const NOTIF_BLACKLIST = new Set(["spotify_player", "spotify", "playerctld"])

interface StoredNotif {
    id: number
    appName: string
    summary: string
    body: string
    time: number
    icon: string
}

function timeAgo(unixTime: number): string {
    const now = Math.floor(Date.now() / 1000)
    const diff = now - unixTime
    if (diff < 60) return "just now"
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    const then = GLib.DateTime.new_from_unix_local(unixTime)
    return then ? (then.format("%d %b") || "") : ""
}

// Tick every 30s so "just now" → "1m ago" etc.
const [timeTick, setTimeTick] = createState(0)
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30_000, () => {
    setTimeTick(timeTick.get() + 1)
    return true
})

// ── Calendar ─────────────────────────────────────────────────────────────────

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

function getCalendarData(year: number, month: number) {
    const firstDay = new Date(year, month, 1)
    let startDow = firstDay.getDay() - 1
    if (startDow < 0) startDow = 6

    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const daysInPrev = new Date(year, month, 0).getDate()

    const today = new Date()
    const todayDate = today.getDate()
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month

    const cells: { day: number; current: boolean; today: boolean }[] = []

    for (let i = startDow - 1; i >= 0; i--) {
        cells.push({ day: daysInPrev - i, current: false, today: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ day: d, current: true, today: isCurrentMonth && d === todayDate })
    }
    while (cells.length < 42) {
        cells.push({ day: cells.length - startDow - daysInMonth + 1, current: false, today: false })
    }
    if (cells.length > 35 && cells.slice(35).every((c) => !c.current)) {
        cells.splice(35)
    }

    return cells
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

function Calendar() {
    const now = new Date()
    const [viewYear, setViewYear] = createState(now.getFullYear())
    const [viewMonth, setViewMonth] = createState(now.getMonth())

    const title = viewMonth((m) => `${MONTH_NAMES[m]} ${viewYear.get()}`)

    function prev() {
        const m = viewMonth.get()
        if (m === 0) { setViewYear(viewYear.get() - 1); setViewMonth(11) }
        else setViewMonth(m - 1)
    }

    function next() {
        const m = viewMonth.get()
        if (m === 11) { setViewYear(viewYear.get() + 1); setViewMonth(0) }
        else setViewMonth(m + 1)
    }

    return (
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8} class="cal">
            <box class="cal-header" spacing={0}>
                <button class="cal-nav" onClicked={prev}>
                    <label label="‹" />
                </button>
                <label class="cal-title" label={title} hexpand halign={Gtk.Align.CENTER} />
                <button class="cal-nav" onClicked={next}>
                    <label label="›" />
                </button>
            </box>

            <box class="cal-row" homogeneous>
                {DAYS.map((d) => (
                    <label class="cal-dow" label={d} halign={Gtk.Align.CENTER} />
                ))}
            </box>

            <box orientation={Gtk.Orientation.VERTICAL} spacing={2}
                $={(self) => {
                    const rebuild = () => {
                        const data = getCalendarData(viewYear.get(), viewMonth.get())
                        self.get_children().forEach((c: any) => c.destroy())
                        const rows = Math.ceil(data.length / 7)
                        for (let r = 0; r < rows; r++) {
                            const row = new Astal.Box({ homogeneous: true })
                            row.get_style_context().add_class("cal-row")
                            for (let c = 0; c < 7; c++) {
                                const cell = data[r * 7 + c]
                                if (!cell) continue
                                const lbl = new Gtk.Label({
                                    label: `${cell.day}`,
                                    halign: Gtk.Align.CENTER,
                                    valign: Gtk.Align.CENTER,
                                })
                                lbl.get_style_context().add_class("cal-day")
                                if (cell.today) lbl.get_style_context().add_class("cal-today")
                                if (!cell.current) lbl.get_style_context().add_class("cal-other")
                                row.pack_start(lbl, true, true, 0)
                            }
                            self.pack_start(row, false, false, 0)
                            row.show_all()
                        }
                    }
                    rebuild()
                    const u1 = viewMonth.subscribe(rebuild)
                    const u2 = viewYear.subscribe(rebuild)
                    self.connect("destroy", () => { u1(); u2() })
                }}
            />
        </box>
    )
}

// ── Audio ────────────────────────────────────────────────────────────────────

function getVolumeFraction(): number {
    try {
        const out = exec("wpctl get-volume @DEFAULT_AUDIO_SINK@")
        if (out.includes("[MUTED]")) return 0
        const match = out.match(/Volume:\s+([\d.]+)/)
        return match ? parseFloat(match[1]) : 0
    } catch {
        return 0
    }
}

const [volumeFrac, setVolumeFrac] = createState(getVolumeFraction())
const volumeLabel = volumeFrac((v) => `${Math.round(v * 100)}%`)
const volumeIcon = volumeFrac((v) => {
    if (v === 0) return "audio-volume-muted-symbolic"
    if (v > 0.66) return "audio-volume-high-symbolic"
    if (v > 0.33) return "audio-volume-medium-symbolic"
    return "audio-volume-low-symbolic"
})

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    setVolumeFrac(getVolumeFraction())
    return true
})

// Brightness
function getBrightness(): number {
    try {
        const cur = parseInt(exec("brightnessctl get"), 10)
        const max = parseInt(exec("brightnessctl max"), 10)
        return max > 0 ? cur / max : 0
    } catch {
        return 0
    }
}

const hasBrightness = (() => {
    try { exec("brightnessctl get"); return true } catch { return false }
})()

const brightFrac = createPoll(getBrightness(), 2000, getBrightness)
const brightLabel = brightFrac((v) => `${Math.round(v * 100)}%`)

// Network
function getNetInfo(): [string, string] {
    try {
        const out = exec("nmcli -t -f TYPE,STATE,CONNECTION device")
        for (const line of out.split("\n")) {
            const [type, state, name] = line.split(":")
            if (state === "connected") {
                if (type === "wifi") return ["network-wireless-symbolic", name || "Wi-Fi"]
                if (type === "ethernet") return ["network-wired-symbolic", name || "Ethernet"]
            }
        }
        return ["network-offline-symbolic", "Offline"]
    } catch {
        return ["network-error-symbolic", "Error"]
    }
}

const netInfo = createPoll(getNetInfo(), 5000, getNetInfo)
const netIcon = netInfo((d) => d[0])
const netName = netInfo((d) => d[1])

// Per-app audio streams
interface AppStream {
    index: string
    name: string
    volume: number
    icon: string
}

function getAppStreams(): AppStream[] {
    try {
        const out = exec(["bash", "-c", "pactl list sink-inputs 2>/dev/null"])
        if (!out.trim()) return []

        const streams: AppStream[] = []
        const blocks = out.split("Sink Input #")

        for (const block of blocks) {
            if (!block.trim()) continue
            const idxMatch = block.match(/^(\d+)/)
            if (!idxMatch) continue

            const volMatch = block.match(/Volume:.*?(\d+)%/)
            const nameMatch = block.match(/application\.name\s*=\s*"([^"]*)"/)
            const iconMatch = block.match(/application\.icon_name\s*=\s*"([^"]*)"/)

            if (nameMatch) {
                streams.push({
                    index: idxMatch[1],
                    name: nameMatch[1],
                    volume: volMatch ? parseInt(volMatch[1], 10) : 100,
                    icon: iconMatch ? iconMatch[1] : "audio-x-generic-symbolic",
                })
            }
        }
        return streams
    } catch {
        return []
    }
}

const [appStreams, setAppStreams] = createState<AppStream[]>(getAppStreams())

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    setAppStreams(getAppStreams())
    return true
})

// ── Sidebar State ────────────────────────────────────────────────────────────

const [sidebarOpen, setSidebarOpen] = createState(false)
const [sidebarVisible, setSidebarVisible] = createState(false)
const [activeTab, setActiveTab] = createState<"main" | "audio">("main")

const TRANSITION_MS = 300
const clearRevealers: Gtk.Revealer[] = []

export function toggleSidebar() {
    const opening = !sidebarOpen.get()
    if (opening) {
        setSidebarVisible(true)
        timeout(10, () => setSidebarOpen(true))
    } else {
        setSidebarOpen(false)
        timeout(TRANSITION_MS, () => setSidebarVisible(false))
    }
}

function hideSidebar() {
    setSidebarOpen(false)
    timeout(TRANSITION_MS, () => setSidebarVisible(false))
}

// ── Sidebar Widget ───────────────────────────────────────────────────────────

export default function Sidebar() {
    let win: Astal.Window

    const notifd = AstalNotifd.get_default()
    const [notifications, setNotifications] = createState<StoredNotif[]>([])

    const onNotified = notifd.connect("notified", (_, id, replaced) => {
        const n = notifd.get_notification(id)
        const appKey = (n.appName || "").toLowerCase()
        if (NOTIF_BLACKLIST.has(appKey)) return

        const stored: StoredNotif = {
            id: n.id,
            appName: n.appName || "Notification",
            summary: n.summary || "",
            body: n.body || "",
            time: n.time,
            icon: resolveIcon(n),
        }

        if (replaced && notifications.get().some((x) => x.id === id)) {
            setNotifications((ns) => ns.map((x) => (x.id === id ? stored : x)))
        } else {
            setNotifications((ns) => [stored, ...ns].slice(0, 50))
        }
    })

    onCleanup(() => {
        notifd.disconnect(onNotified)
        win.destroy()
    })

    const isMain = activeTab((t) => t === "main")
    const isAudio = activeTab((t) => t === "audio")

    return (
        <window
            $={(self) => (win = self)}
            name="sidebar"
            application={app}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.RIGHT |
                Astal.WindowAnchor.BOTTOM
            }
            exclusivity={Astal.Exclusivity.NORMAL}
            visible={sidebarVisible}
            keymode={Astal.Keymode.NONE}
        >
            <revealer
                transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
                transitionDuration={TRANSITION_MS}
                revealChild={sidebarOpen}
            >
            <box class="sidebar" orientation={Gtk.Orientation.VERTICAL}>
                {/* ── Header ── */}
                <box class="sidebar-header" orientation={Gtk.Orientation.VERTICAL}>
                    <label class="sidebar-time" label={fullTime} xalign={0} />
                    <label class="sidebar-date" label={fullDate} xalign={0} />
                </box>

                {/* ── Tab Bar ── */}
                <box class="sidebar-tabs" homogeneous spacing={0}>
                    <button
                        class="sidebar-tab"
                        onClicked={() => setActiveTab("main")}
                        $={(self) => {
                            const u = activeTab.subscribe((t) => {
                                if (t === "main") self.get_style_context().add_class("active")
                                else self.get_style_context().remove_class("active")
                            })
                            self.get_style_context().add_class("active")
                            self.connect("destroy", () => u())
                        }}
                    >
                        <icon icon="preferences-system-notifications-symbolic" />
                    </button>
                    <button
                        class="sidebar-tab"
                        onClicked={() => setActiveTab("audio")}
                        $={(self) => {
                            const u = activeTab.subscribe((t) => {
                                if (t === "audio") self.get_style_context().add_class("active")
                                else self.get_style_context().remove_class("active")
                            })
                            self.connect("destroy", () => u())
                        }}
                    >
                        <icon icon="audio-volume-high-symbolic" />
                    </button>
                </box>

                {/* ══════════ Tab: Main ══════════ */}
                <box orientation={Gtk.Orientation.VERTICAL} visible={isMain} vexpand>
                    {/* Calendar */}
                    <box class="sidebar-section" orientation={Gtk.Orientation.VERTICAL}>
                        <Calendar />
                    </box>

                    {/* Player */}
                    <box
                        class="sidebar-section"
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={10}
                        visible={hasPlayer}
                    >
                        <label class="sidebar-section-title" label="Now Playing" xalign={0} />
                        <box spacing={12}>
                            <box
                                class="sidebar-player-art"
                                css={artPath((path) => {
                                    if (!path) return ""
                                    return `background-image: url("${path}"); background-size: cover; background-position: center;`
                                })}
                                visible={artPath((p) => !!p)}
                            />
                            <box
                                orientation={Gtk.Orientation.VERTICAL}
                                valign={Gtk.Align.CENTER}
                                spacing={2}
                                hexpand
                            >
                                <label
                                    class="sidebar-player-title"
                                    label={player((p) => p?.title || "")}
                                    xalign={0}
                                    maxWidthChars={22}
                                    ellipsize={3}
                                />
                                <label
                                    class="sidebar-player-artist"
                                    label={player((p) => p?.artist || "")}
                                    xalign={0}
                                    maxWidthChars={22}
                                    ellipsize={3}
                                />
                            </box>
                        </box>
                        <box halign={Gtk.Align.CENTER} spacing={12}>
                            <button class="sidebar-player-btn" onClicked={prevTrack}>
                                <label label="⏮" />
                            </button>
                            <button class="sidebar-player-btn sidebar-player-play" onClicked={togglePlayPause}>
                                <label label={player((p) => (p?.playing ? "⏸" : "▶"))} />
                            </button>
                            <button class="sidebar-player-btn" onClicked={nextTrack}>
                                <label label="⏭" />
                            </button>
                        </box>
                    </box>

                    {/* Notifications */}
                    <box class="sidebar-section sidebar-notifications" orientation={Gtk.Orientation.VERTICAL} spacing={8} vexpand>
                        <box spacing={8}>
                            <label class="sidebar-section-title" label="Notifications" xalign={0} hexpand />
                            <button
                                class="sidebar-clear-btn"
                                onClicked={() => {
                                    // Animate: reveal each card off with cascade delay
                                    const cards = clearRevealers.slice()
                                    cards.forEach((rev, i) => {
                                        timeout(i * 60, () => {
                                            try { rev.revealChild = false } catch {}
                                        })
                                    })
                                    // Clear data after all animations finish
                                    timeout(cards.length * 60 + 250, () => setNotifications([]))
                                }}
                            >
                                <label label="Clear all" />
                            </button>
                        </box>

                        <scrollable class="notification-scroll" vexpand>
                            <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                                <For each={notifications}>
                                    {(n: StoredNotif) => (
                                        <revealer
                                            transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
                                            transitionDuration={200}
                                            revealChild={true}
                                            $={(self) => {
                                                clearRevealers.push(self)
                                                self.connect("destroy", () => {
                                                    const idx = clearRevealers.indexOf(self)
                                                    if (idx >= 0) clearRevealers.splice(idx, 1)
                                                })
                                            }}
                                        >
                                        <box class="notif-card" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                                            <box spacing={8}>
                                                <icon class="notif-app-icon" icon={n.icon} />
                                                <label class="notif-app" label={n.appName} hexpand xalign={0} />
                                                <label class="notif-time"
                                                    label={timeTick(() => timeAgo(n.time))}
                                                />
                                                <button
                                                    class="notif-dismiss"
                                                    onClicked={() => {
                                                        setNotifications((ns) => ns.filter((x) => x.id !== n.id))
                                                    }}
                                                >
                                                    <icon icon="window-close-symbolic" />
                                                </button>
                                            </box>
                                            <label class="notif-summary" label={n.summary} xalign={0} wrap />
                                            {n.body && (
                                                <label class="notif-body" label={n.body} xalign={0} wrap useMarkup />
                                            )}
                                        </box>
                                        </revealer>
                                    )}
                                </For>

                                <box
                                    class="notif-empty"
                                    halign={Gtk.Align.CENTER}
                                    valign={Gtk.Align.CENTER}
                                    vexpand
                                    visible={notifications((ns) => ns.length === 0)}
                                    orientation={Gtk.Orientation.VERTICAL}
                                    spacing={8}
                                >
                                    <icon class="notif-empty-icon" icon="notifications-disabled-symbolic" />
                                    <label class="notif-empty-label" label="No notifications" />
                                </box>
                            </box>
                        </scrollable>
                    </box>
                </box>

                {/* ══════════ Tab: Audio ══════════ */}
                <box orientation={Gtk.Orientation.VERTICAL} visible={isAudio} vexpand>
                    {/* Master volume */}
                    <box class="sidebar-section" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
                        <label class="sidebar-section-title" label="Master Volume" xalign={0} />
                        <box class="qs-row" spacing={8}>
                            <eventbox
                                onClick={() => {
                                    execAsync(["bash", "-c", "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"]).catch(() => {})
                                    timeout(100, () => setVolumeFrac(getVolumeFraction()))
                                }}
                            >
                                <icon class="qs-icon" icon={volumeIcon} />
                            </eventbox>
                            <slider
                                class="qs-slider"
                                hexpand
                                min={0}
                                max={1}
                                step={0.05}
                                value={volumeFrac}
                                onDragged={(self: { value: number }) => {
                                    setVolumeFrac(self.value)
                                    execAsync(["bash", "-c", `wpctl set-volume @DEFAULT_AUDIO_SINK@ ${self.value}`]).catch(() => {})
                                }}
                            />
                            <label class="qs-value" label={volumeLabel} />
                        </box>

                        {hasBrightness && (
                            <box class="qs-row" spacing={8}>
                                <icon class="qs-icon" icon="display-brightness-symbolic" />
                                <slider
                                    class="qs-slider"
                                    hexpand
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={brightFrac}
                                    onDragged={(self: { value: number }) => {
                                        const pct = Math.round(self.value * 100)
                                        execAsync(["brightnessctl", "set", `${pct}%`]).catch(() => {})
                                    }}
                                />
                                <label class="qs-value" label={brightLabel} />
                            </box>
                        )}

                        <box class="qs-row" spacing={8}>
                            <icon class="qs-icon" icon={netIcon} />
                            <label class="qs-net-label" label={netName} xalign={0} hexpand />
                        </box>
                    </box>

                    {/* Per-app streams */}
                    <box class="sidebar-section" orientation={Gtk.Orientation.VERTICAL} spacing={10} vexpand>
                        <label class="sidebar-section-title" label="Applications" xalign={0} />

                        <scrollable vexpand>
                            <box orientation={Gtk.Orientation.VERTICAL} spacing={10}>
                                <For each={appStreams}>
                                    {(s: AppStream) => (
                                        <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                                            <box spacing={8}>
                                                <icon class="qs-icon" icon={s.icon} />
                                                <label class="app-stream-name" label={s.name} xalign={0} hexpand />
                                                <label class="qs-value" label={`${s.volume}%`} />
                                            </box>
                                            <slider
                                                class="qs-slider"
                                                min={0}
                                                max={1}
                                                step={0.05}
                                                value={s.volume / 100}
                                                onDragged={(self: { value: number }) => {
                                                    const pct = Math.round(self.value * 100)
                                                    execAsync(["pactl", "set-sink-input-volume", s.index, `${pct}%`]).catch(() => {})
                                                }}
                                            />
                                        </box>
                                    )}
                                </For>

                                <box
                                    class="notif-empty"
                                    halign={Gtk.Align.CENTER}
                                    valign={Gtk.Align.CENTER}
                                    vexpand
                                    visible={appStreams((ss) => ss.length === 0)}
                                    orientation={Gtk.Orientation.VERTICAL}
                                    spacing={8}
                                >
                                    <icon class="notif-empty-icon" icon="audio-speakers-symbolic" />
                                    <label class="notif-empty-label" label="No active streams" />
                                </box>
                            </box>
                        </scrollable>
                    </box>
                </box>
            </box>
            </revealer>
        </window>
    )
}
