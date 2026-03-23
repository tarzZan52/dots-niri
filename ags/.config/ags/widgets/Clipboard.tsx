import { Astal, Gtk, Gdk } from "ags/gtk3"
import { createState, For, onCleanup } from "ags"
import { exec, execAsync } from "ags/process"
import { timeout } from "ags/time"
import app from "ags/gtk3/app"
import GLib from "gi://GLib"
import GdkPixbuf from "gi://GdkPixbuf"

interface ClipEntry {
    raw: string
    id: string
    preview: string
    isImage: boolean
    imageInfo: string
    thumbPath: string | null
}

const [clipOpen, setClipOpen] = createState(false)
const [entries, setEntries] = createState<ClipEntry[]>([])
const [query, setQuery] = createState("")
const [filtered, setFiltered] = createState<ClipEntry[]>([])

function updateFiltered() {
    const q = (query.get() as string).toLowerCase()
    const es = entries.get() as ClipEntry[]
    if (!q) {
        setFiltered(es)
    } else {
        setFiltered(es.filter((e) =>
            e.preview.toLowerCase().includes(q)
            || e.imageInfo.toLowerCase().includes(q)
        ))
    }
}

const THUMB_DIR = "/tmp/ags-clip-thumbs"

function ensureThumbDir() {
    GLib.mkdir_with_parents(THUMB_DIR, 0o755)
}

function generateThumb(entry: ClipEntry): string | null {
    const thumbPath = `${THUMB_DIR}/clip_${entry.id}.png`
    if (GLib.file_test(thumbPath, GLib.FileTest.EXISTS)) return thumbPath
    try {
        const escaped = entry.raw.replace(/'/g, "'\\''")
        exec(["bash", "-c", `echo '${escaped}' | cliphist decode > '${thumbPath}'`])
        if (GLib.file_test(thumbPath, GLib.FileTest.EXISTS)) return thumbPath
    } catch { /* ignore */ }
    return null
}

function parseImageInfo(content: string): string {
    const m = content.match(/(\d+)\s*KiB\s+(\w+)\s+(\d+)x(\d+)/)
    if (m) return `${m[3]}×${m[4]}  ${m[1]} KiB`
    const m2 = content.match(/(\d+)\s*(\w+)\s+(\d+)x(\d+)/)
    if (m2) return `${m2[3]}×${m2[4]}`
    return "Image"
}

function parseEntries(raw: string): ClipEntry[] {
    ensureThumbDir()
    return raw
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 50)
        .map((line) => {
            const tabIdx = line.indexOf("\t")
            const id = tabIdx >= 0 ? line.substring(0, tabIdx).trim() : line.trim()
            const content = tabIdx >= 0 ? line.substring(tabIdx + 1) : line
            const isImage = content.startsWith("[[ binary data")
                || content.includes("image/")
                || /\[\[.*png.*\]\]/.test(content)
                || /\[\[.*jpg.*\]\]/.test(content)
                || /\[\[.*jpeg.*\]\]/.test(content)

            let thumbPath: string | null = null
            let imageInfo = ""
            if (isImage) {
                imageInfo = parseImageInfo(content)
                const entry = { raw: line, id, preview: "", isImage, imageInfo, thumbPath: null }
                thumbPath = generateThumb(entry)
            }

            return {
                raw: line,
                id,
                preview: isImage ? "" : content.substring(0, 120),
                isImage,
                imageInfo,
                thumbPath,
            }
        })
}

function loadEntries() {
    try {
        const out = exec(["bash", "-c", "cliphist list 2>/dev/null | head -50"])
        setEntries(parseEntries(out))
    } catch (e) {
        console.error("[Clipboard] loadEntries failed:", e)
        setEntries([])
    }
    updateFiltered()
}

function selectEntry(entry: ClipEntry) {
    const escaped = entry.raw.replace(/'/g, "'\\''")
    execAsync(["bash", "-c", `echo '${escaped}' | cliphist decode | wl-copy`]).catch(() => {})
    hideClipboard()
}

function deleteEntry(entry: ClipEntry) {
    const escaped = entry.raw.replace(/'/g, "'\\''")
    execAsync(["bash", "-c", `echo '${escaped}' | cliphist delete`]).catch(() => {})
    setEntries((es) => es.filter((e) => e.id !== entry.id))
    timeout(10, () => updateFiltered())
}

export function toggleClipboard() {
    const win = app.get_window("clipboard")
    if (!win) return
    if (win.visible) {
        hideClipboard()
    } else {
        loadEntries()
        setQuery("")
        win.visible = true
        timeout(10, () => setClipOpen(true))
    }
}

function hideClipboard() {
    setClipOpen(false)
    const win = app.get_window("clipboard")
    timeout(250, () => {
        if (win) win.visible = false
    })
}

function ScaledThumb({ path }: { path: string }) {
    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 200, 120, true)
        const img = Gtk.Image.new_from_pixbuf(pixbuf)
        img.get_style_context().add_class("clip-thumb")
        return img
    } catch {
        return <icon icon="image-x-generic-symbolic" class="clip-thumb-icon" />
    }
}

export default function Clipboard() {
    let win: Astal.Window
    let searchEntry: Gtk.Entry

    onCleanup(() => win.destroy())

    return (
        <window
            $={(self) => (win = self)}
            name="clipboard"
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
            onKeyPressEvent={(_self: Astal.Window, event: Gdk.Event) => {
                const [, keyval] = event.get_keyval()
                if (keyval === Gdk.KEY_Escape) {
                    hideClipboard()
                    return true
                }
                return false
            }}
            onNotifyVisible={(self: Astal.Window) => {
                if (self.visible && searchEntry) {
                    searchEntry.set_text("")
                    timeout(50, () => searchEntry.grab_focus())
                }
            }}
        >
            <box halign={Gtk.Align.CENTER} valign={Gtk.Align.START} class="clip-anchor">
                <revealer
                    transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
                    transitionDuration={250}
                    revealChild={clipOpen}
                >
                    <box class="clip-popup" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
                        <entry
                            class="clip-search"
                            placeholderText="Search clipboard..."
                            $={(self) => {
                                searchEntry = self
                                const u = clipOpen.subscribe((open) => {
                                    if (open) {
                                        self.set_text("")
                                        timeout(50, () => {
                                            self.grab_focus()
                                            self.set_position(-1)
                                        })
                                    }
                                })
                                self.connect("destroy", () => u())
                            }}
                            onChanged={(self: Gtk.Entry) => {
                                setQuery(self.text)
                                updateFiltered()
                            }}
                        />

                        <scrollable class="clip-scroll" vexpand heightRequest={440}>
                            <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
                                <For each={filtered}>
                                    {(e: ClipEntry) => (
                                        <box class={`clip-entry ${e.isImage ? "clip-entry-image" : ""}`} spacing={8}>
                                            <button
                                                class="clip-select"
                                                hexpand
                                                onClicked={() => selectEntry(e)}
                                            >
                                                {e.isImage && e.thumbPath ? (
                                                    <box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
                                                        <ScaledThumb path={e.thumbPath} />
                                                        <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} spacing={4}>
                                                            <label label="Screenshot" xalign={0} class="clip-img-title" />
                                                            <label label={e.imageInfo} xalign={0} class="clip-img-info" />
                                                        </box>
                                                    </box>
                                                ) : (
                                                    <label
                                                        label={e.preview}
                                                        xalign={0}
                                                        maxWidthChars={55}
                                                        ellipsize={3}
                                                        class="clip-text"
                                                    />
                                                )}
                                            </button>
                                            <button
                                                class="clip-delete"
                                                valign={Gtk.Align.CENTER}
                                                onClicked={() => deleteEntry(e)}
                                            >
                                                <icon icon="edit-delete-symbolic" />
                                            </button>
                                        </box>
                                    )}
                                </For>

                                <box
                                    class="notif-empty"
                                    halign={Gtk.Align.CENTER}
                                    valign={Gtk.Align.CENTER}
                                    vexpand
                                    visible={filtered((f) => f.length === 0)}
                                    orientation={Gtk.Orientation.VERTICAL}
                                    spacing={8}
                                >
                                    <icon class="notif-empty-icon" icon="edit-paste-symbolic" />
                                    <label class="notif-empty-label" label="Clipboard empty" />
                                </box>
                            </box>
                        </scrollable>
                    </box>
                </revealer>
            </box>
        </window>
    )
}
