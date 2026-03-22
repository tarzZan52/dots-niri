import { Astal, Gtk, Gdk } from "ags/gtk3"
import { createState, For, onCleanup } from "ags"
import { execAsync } from "ags/process"
import app from "ags/gtk3/app"
import AstalApps from "gi://AstalApps"
import GLib from "gi://GLib"

const iconTheme = Gtk.IconTheme.get_default()

function preferSymbolic(name: string): string {
    if (!name || name.endsWith("-symbolic")) return name
    const sym = name + "-symbolic"
    if (iconTheme.has_icon(sym)) return sym
    return name
}

interface Result {
    name: string
    iconName: string
    exec: () => void
}

const COMMANDS: Result[] = [
    { name: "Power Off", iconName: "system-shutdown-symbolic", exec: () => execAsync("systemctl poweroff").catch(() => {}) },
    { name: "Reboot", iconName: "system-reboot-symbolic", exec: () => execAsync("systemctl reboot").catch(() => {}) },
    { name: "Log Out", iconName: "system-log-out-symbolic", exec: () => execAsync("niri msg action quit").catch(() => {}) },
    { name: "Lock", iconName: "system-lock-screen-symbolic", exec: () => execAsync("hyprlock").catch(() => {}) },
    { name: "Suspend", iconName: "system-suspend-symbolic", exec: () => execAsync("systemctl suspend").catch(() => {}) },
]

const apps = new AstalApps.Apps()
const [results, setResults] = createState<Result[]>([])

function hide() {
    const win = app.get_window("launcher")
    if (win) win.visible = false
}

function search(text: string) {
    const q = text.trim().toLowerCase()
    if (q === "") return setResults([])

    const matched: Result[] = []

    COMMANDS.forEach(cmd => {
        if (cmd.name.toLowerCase().includes(q)) matched.push(cmd)
    })

    apps.fuzzy_query(q).slice(0, 6).forEach(a => {
        matched.push({
            name: a.name,
            iconName: preferSymbolic(a.iconName || "application-x-executable"),
            exec: () => {
                const exe = a.executable || ""
                // Flatpak apps: use "flatpak run <app-id>"
                if (exe.includes("flatpak run") || exe.includes("@@")) {
                    const idMatch = exe.match(/([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){2,})/)
                    if (idMatch) {
                        GLib.spawn_command_line_async(`flatpak run ${idMatch[1]}`)
                        return
                    }
                }
                // Regular apps: strip desktop entry placeholders
                const cmd = exe
                    .replace(/%[UuFfDdNnickvm]/g, "")
                    .replace(/\s+--\s*$/, "")
                    .trim()
                if (cmd) {
                    GLib.spawn_command_line_async(cmd)
                } else {
                    try { a.launch() } catch {}
                }
            },
        })
    })

    setResults(matched.slice(0, 8))
}

function launch(r: Result) {
    r.exec()
    hide()
}

export default function Launcher() {
    let entry: Gtk.Entry
    let win: Astal.Window

    onCleanup(() => win.destroy())

    return (
        <window
            $={(self) => (win = self)}
            name="launcher"
            application={app}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            exclusivity={Astal.Exclusivity.IGNORE}
            keymode={Astal.Keymode.ON_DEMAND}
            visible={false}
            onKeyPressEvent={(self: Astal.Window, event: Gdk.Event) => {
                const [, keyval] = event.get_keyval()
                if (keyval === Gdk.KEY_Escape) {
                    self.visible = false
                    return true
                }
                if (keyval === Gdk.KEY_Return) {
                    const list = results.get()
                    if (list.length > 0) launch(list[0])
                    return true
                }
                return false
            }}
            onNotifyVisible={(self: Astal.Window) => {
                if (self.visible) {
                    setResults([])
                    entry.set_text("")
                    entry.grab_focus()
                }
            }}
        >
            <box
                valign={Gtk.Align.START}
                halign={Gtk.Align.CENTER}
            >
                <box
                    class="launcher"
                    orientation={Gtk.Orientation.VERTICAL}
                >
                    <entry
                        $={(self) => (entry = self)}
                        class="launcher-entry"
                        placeholderText="Search apps..."
                        onChanged={(self: Gtk.Entry) => search(self.text)}
                    />
                    <box class="launcher-results" orientation={Gtk.Orientation.VERTICAL}>
                        <For each={results}>
                            {(r: Result) => (
                                <button class="launcher-item" onClicked={() => launch(r)}>
                                    <box spacing={12}>
                                        <icon class="launcher-icon" icon={r.iconName} />
                                        <label label={r.name} xalign={0} hexpand />
                                    </box>
                                </button>
                            )}
                        </For>
                    </box>
                </box>
            </box>
        </window>
    )
}
