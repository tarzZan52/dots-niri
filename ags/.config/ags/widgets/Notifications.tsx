import { Astal, Gtk } from "ags/gtk3"
import { createState, onCleanup, For } from "ags"
import { timeout } from "ags/time"
import app from "ags/gtk3/app"
import AstalNotifd from "gi://AstalNotifd"
import GLib from "gi://GLib"

const DISMISS_TIMEOUT = 5000

function timeStr(unixTime: number): string {
    return GLib.DateTime.new_from_unix_local(unixTime).format("%H:%M") ?? ""
}

const APP_ICON_MAP: Record<string, string> = {
    "telegram desktop": "telegram",
    "telegram": "telegram",
    "spotify": "spotify",
    "discord": "discord",
    "firefox": "firefox",
    "chromium": "chromium-browser",
    "google chrome": "google-chrome",
    "code": "vscode",
    "visual studio code": "vscode",
    "obs": "com.obsproject.Studio",
    "slack": "slack",
    "thunderbird": "thunderbird",
    "steam": "steam",
    "vlc": "vlc",
    "nautilus": "org.gnome.Nautilus",
    "files": "org.gnome.Nautilus",
    "terminal": "utilities-terminal",
    "kitty": "kitty",
    "alacritty": "Alacritty",
    "foot": "foot",
}

export function resolveIcon(n: AstalNotifd.Notification): string {
    // 1. appIcon from notification
    if (n.appIcon) return n.appIcon

    // 2. desktopEntry
    if (n.desktopEntry) return n.desktopEntry

    // 3. fallback map by appName
    const key = (n.appName || "").toLowerCase()
    const mapped = APP_ICON_MAP[key]
    if (mapped) return mapped

    // 4. try appName directly as icon name (lowercase)
    if (key) return key

    // 5. generic fallback
    return "preferences-system-notifications-symbolic"
}

function Notification({ notification: n }: { notification: AstalNotifd.Notification }) {
    const iconName = resolveIcon(n)

    return (
        <eventbox>
            <box class="notification" orientation={Gtk.Orientation.VERTICAL}>
                <box class="notification-header" spacing={8}>
                    <icon class="notification-app-icon" icon={iconName} />
                    <label
                        class="notification-app-name"
                        label={n.appName || "Notification"}
                        hexpand
                        xalign={0}
                    />
                    <label class="notification-time" label={timeStr(n.time)} />
                    <button class="notification-close" onClicked={() => n.dismiss()}>
                        <icon icon="window-close-symbolic" />
                    </button>
                </box>
                <label
                    class="notification-summary"
                    label={n.summary}
                    xalign={0}
                    wrap
                />
                {n.body && (
                    <label
                        class="notification-text"
                        label={n.body}
                        xalign={0}
                        wrap
                        useMarkup
                    />
                )}
                {n.actions.length > 0 && (
                    <box class="notification-actions" spacing={8}>
                        {n.actions.map(({ label, id }) => (
                            <button class="notification-action" onClicked={() => n.invoke(id)} hexpand>
                                <label label={label} halign={Gtk.Align.CENTER} hexpand />
                            </button>
                        ))}
                    </box>
                )}
            </box>
        </eventbox>
    )
}

export default function NotificationPopups() {
    let win: Astal.Window
    const notifd = AstalNotifd.get_default()
    const [notifications, setNotifications] = createState<AstalNotifd.Notification[]>([])

    const POPUP_BLACKLIST = new Set(["spotify_player", "spotify", "playerctld"])

    const onNotified = notifd.connect("notified", (_, id, replaced) => {
        const n = notifd.get_notification(id)
        const appKey = (n.appName || "").toLowerCase().replace(/\s+/g, "_")
        if (POPUP_BLACKLIST.has(appKey)) {
            try { n.dismiss() } catch {}
            return
        }
        if (replaced && notifications.get().some((x) => x.id === id)) {
            setNotifications((ns) => ns.map((x) => (x.id === id ? n : x)))
        } else {
            setNotifications((ns) => [n, ...ns])
        }

        // Auto-dismiss after timeout
        timeout(DISMISS_TIMEOUT, () => {
            try { n.dismiss() } catch {}
        })
    })

    const onResolved = notifd.connect("resolved", (_, id) => {
        setNotifications((ns) => ns.filter((x) => x.id !== id))
    })

    onCleanup(() => {
        notifd.disconnect(onNotified)
        notifd.disconnect(onResolved)
        win.destroy()
    })

    return (
        <window
            $={(self) => (win = self)}
            name="notifications"
            application={app}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
            exclusivity={Astal.Exclusivity.NORMAL}
            visible={notifications((ns) => ns.length > 0)}
        >
            <box
                class="notifications"
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
            >
                <For each={notifications}>
                    {(n: AstalNotifd.Notification) => (
                        <Notification notification={n} />
                    )}
                </For>
            </box>
        </window>
    )
}
