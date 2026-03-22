import app from "ags/gtk3/app"
import { Gdk } from "ags/gtk3"
import style from "./style.scss"
import Bar from "./Bar"
import Launcher from "./widgets/Launcher"
import NotificationPopups from "./widgets/Notifications"
import Sidebar, { toggleSidebar } from "./widgets/Sidebar"
import PlayerPopup from "./widgets/PlayerPopup"
import { TrayMenuPopup } from "./widgets/Tray"
import Clipboard, { toggleClipboard } from "./widgets/Clipboard"
import { monitorFile } from "ags/file"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"

const SCSS_DIR = GLib.get_current_dir() || `${GLib.get_home_dir()}/.dotfiles/ags/.config/ags`

function reloadCss() {
    execAsync(["sass", "--no-source-map", "--style=compressed",
        `${SCSS_DIR}/style.scss`, `${SCSS_DIR}/style-compiled.css`])
        .then(() => {
            app.reset_css()
            app.apply_css(`${SCSS_DIR}/style-compiled.css`)
        })
        .catch((e) => console.error("CSS reload failed:", e))
}

app.start({
    css: style,
    requestHandler(argv, response) {
        const [cmd] = argv
        if (cmd === "toggle-launcher") {
            const win = app.get_window("launcher")
            if (win) win.visible = !win.visible
            return response("ok")
        }
        if (cmd === "toggle-sidebar") {
            toggleSidebar()
            return response("ok")
        }
        if (cmd === "toggle-clipboard") {
            toggleClipboard()
            return response("ok")
        }
        if (cmd === "reload-css") {
            reloadCss()
            return response("ok")
        }
        response("unknown command")
    },
    main() {
        const display = Gdk.Display.get_default()!
        for (let i = 0; i < display.get_n_monitors(); i++) {
            Bar(display.get_monitor(i)!)
        }
        Launcher()
        NotificationPopups()
        Sidebar()
        PlayerPopup()
        TrayMenuPopup()
        Clipboard()

        // Watch for color changes and hot-reload CSS
        monitorFile(`${SCSS_DIR}/scss/_colors.scss`, () => {
            reloadCss()
        })
    },
})
