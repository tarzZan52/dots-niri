import { Astal, Gdk, Gtk } from "ags/gtk3"
import app from "ags/gtk3/app"
import { onCleanup } from "ags"
import Workspaces from "./widgets/Workspaces"
import Clock from "./widgets/Clock"
import System from "./widgets/System"
import Player from "./widgets/Player"
import { toggleSidebar } from "./widgets/Sidebar"
import Tray from "./widgets/Tray"

export default function Bar(gdkmonitor: Gdk.Monitor) {
    let win: Astal.Window
    const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

    onCleanup(() => {
        win.destroy()
    })

    return (
        <window
            $={(self) => (win = self)}
            gdkmonitor={gdkmonitor}
            anchor={TOP | LEFT | RIGHT}
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            application={app}
        >
            <centerbox class="bar">
                <box $type="start">
                    <Workspaces />
                </box>
                <box $type="center" spacing={8}>
                    <eventbox onClick={toggleSidebar}>
                        <Clock />
                    </eventbox>
                    <Player />
                </box>
                <box $type="end" halign={Gtk.Align.END} spacing={8}>
                    <Tray />
                    <System />
                </box>
            </centerbox>
        </window>
    )
}
