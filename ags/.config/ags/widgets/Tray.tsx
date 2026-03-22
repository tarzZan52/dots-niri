import { Astal, Gtk, Gdk } from "ags/gtk3"
import { createBinding, createState, For, onCleanup } from "ags"
import { execAsync } from "ags/process"
import app from "ags/gtk3/app"
import AstalTray from "gi://AstalTray"
import { timeout } from "ags/time"
import Gio from "gi://Gio"

// ── Tray menu popup state ───────────────────────────────────────────────────
const [menuVis, setMenuVis] = createState(false)
const [menuRevealed, setMenuRevealed] = createState(false)
const [menuItems, setMenuItems] = createState<{ label: string; action: string; target: any }[]>([])
const [menuX, setMenuX] = createState(0)

let activeItem: AstalTray.TrayItem | null = null
let lastClick = 0
const CLICK_COOLDOWN = 500

function closeTrayMenu() {
    if (!menuVis.get()) return
    setMenuRevealed(false)
    timeout(250, () => setMenuVis(false))
}

function openTrayMenu(item: AstalTray.TrayItem, widget: Gtk.Widget) {
    // Toggle
    if (menuVis.get()) {
        closeTrayMenu()
        return
    }

    try {
        const model = item.menuModel
        if (!model) return

        activeItem = item

        // Position under the clicked icon
        const toplevel = widget.get_toplevel()
        if (toplevel) {
            const [ok, x] = widget.translate_coordinates(toplevel, 0, 0)
            if (ok) {
                const alloc = widget.get_allocation()
                setMenuX(x + Math.floor(alloc.width / 2))
            }
        }

        // Parse GMenuModel
        const entries: { label: string; action: string; target: any }[] = []
        const parse = (m: Gio.MenuModel) => {
            try {
                const n = m.get_n_items()
                for (let i = 0; i < n; i++) {
                    const section = m.get_item_link(i, Gio.MENU_LINK_SECTION)
                    if (section) {
                        parse(section)
                    } else {
                        const label = m.get_item_attribute_value(i, "label", null)
                        const action = m.get_item_attribute_value(i, "action", null)
                        const target = m.get_item_attribute_value(i, "target", null)
                        if (label && action) {
                            entries.push({
                                label: label.get_string()[0],
                                action: action.get_string()[0],
                                target,
                            })
                        }
                    }
                }
            } catch {}
        }
        parse(model)

        setMenuItems(entries)
        setMenuVis(true)
        timeout(10, () => setMenuRevealed(true))
    } catch {}
}

function activateMenuAction(action: string, target: any) {
    try {
        if (!activeItem) return
        const ag = activeItem.actionGroup
        if (!ag) return
        const name = action.replace(/^dbusmenu\./, "")
        ag.activate_action(name, target || null)
    } catch {}
    closeTrayMenu()
}

// ── Tray bar widget ─────────────────────────────────────────────────────────
export default function Tray() {
    const tray = AstalTray.get_default()
    const items = createBinding(tray, "items")

    return (
        <box class="island tray" spacing={2}
            $={(self) => {
                const update = () => {
                    try {
                        const count = tray.get_items().filter(
                            (i) => { try { return i.gicon != null } catch { return false } }
                        ).length
                        self.visible = count > 0
                    } catch { self.visible = false }
                }
                tray.connect("notify::items", update)
                tray.connect("item-removed", () => timeout(100, update))
                tray.connect("item-added", () => timeout(100, update))
                update()
            }}
        >
            <For each={items}>
                {(item: AstalTray.TrayItem) => (
                    <button
                        class="tray-item"
                        visible={createBinding(item, "gicon")((g) => g != null)}
                        $={(self) => {
                            self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
                            self.connect("button-press-event", (_w: Gtk.Widget, ev: Gdk.Event) => {
                                const now = Date.now()
                                if (now - lastClick < CLICK_COOLDOWN) return true
                                lastClick = now
                                try {
                                    const [, btn] = ev.get_button()
                                    if (btn === Gdk.BUTTON_PRIMARY) {
                                        // Use busctl instead of item.activate() to avoid libastal-tray crash
                                        const itemId = item.itemId
                                        if (itemId) {
                                            const [busName, ...rest] = itemId.split("/")
                                            const objPath = "/" + rest.join("/")
                                            execAsync(["busctl", "--user", "call",
                                                busName, objPath,
                                                "org.kde.StatusNotifierItem", "Activate", "ii", "0", "0"
                                            ]).catch(() => {})
                                        }
                                    } else if (btn === Gdk.BUTTON_SECONDARY) {
                                        openTrayMenu(item, _w)
                                    }
                                } catch {}
                                return true
                            })
                        }}
                    >
                        <icon
                            class="tray-icon"
                            gicon={createBinding(item, "gicon")}
                        />
                    </button>
                )}
            </For>
        </box>
    )
}

// ── Tray menu popup window ──────────────────────────────────────────────────
export function TrayMenuPopup() {
    let win: Astal.Window

    onCleanup(() => win.destroy())

    return (
        <window
            $={(self) => (win = self)}
            name="tray-menu"
            application={app}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.LEFT}
            exclusivity={Astal.Exclusivity.IGNORE}
            keymode={Astal.Keymode.NONE}
            visible={menuVis}
            marginTop={52}
            marginLeft={menuX((x) => Math.max(0, x - 100))}
        >
            <eventbox onClickRelease={() => closeTrayMenu()}>
                <revealer
                    transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
                    transitionDuration={250}
                    revealChild={menuRevealed}
                >
                    <box class="tray-menu" orientation={Gtk.Orientation.VERTICAL}>
                        <For each={menuItems}>
                            {(entry: { label: string; action: string; target: any }) => (
                                <button
                                    class="tray-menu-item"
                                    onClicked={() => activateMenuAction(entry.action, entry.target)}
                                >
                                    <label label={entry.label} xalign={0} hexpand />
                                </button>
                            )}
                        </For>
                    </box>
                </revealer>
            </eventbox>
        </window>
    )
}
