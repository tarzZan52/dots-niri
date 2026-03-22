import { Astal, Gtk } from "ags/gtk3"
import { onCleanup } from "ags"
import app from "ags/gtk3/app"
import {
    player,
    artPath,
    popupVis,
    popupRevealed,
    togglePlayPause,
    prevTrack,
    nextTrack,
} from "./Player"

const titleText = player((p) => p?.title || "")
const artistText = player((p) => p?.artist || "")
const playIcon = player((p) => (p?.playing ? "⏸" : "▶"))

const artCss = artPath((path) => {
    if (!path) return ""
    return `background-image: url("${path}"); background-size: cover; background-position: center;`
})

const hasArt = artPath((path) => !!path)

export default function PlayerPopup() {
    let win: Astal.Window

    onCleanup(() => {
        win.destroy()
    })

    return (
        <window
            $={(self) => (win = self)}
            name="player-popup"
            application={app}
            anchor={Astal.WindowAnchor.TOP}
            exclusivity={Astal.Exclusivity.IGNORE}
            visible={popupVis}
            marginTop={52}
        >
            <revealer
                transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
                transitionDuration={250}
                revealChild={popupRevealed}
            >
                <box class="player-strip" spacing={14}>
                    {/* Art thumbnail */}
                    <box class="player-strip-art" css={artCss} visible={hasArt} />

                    {/* Track info */}
                    <box
                        orientation={Gtk.Orientation.VERTICAL}
                        valign={Gtk.Align.CENTER}
                        spacing={2}
                    >
                        <label
                            class="player-strip-title"
                            label={titleText}
                            xalign={0}
                            maxWidthChars={30}
                            ellipsize={3}
                        />
                        <label
                            class="player-strip-artist"
                            label={artistText}
                            xalign={0}
                            maxWidthChars={30}
                            ellipsize={3}
                        />
                    </box>

                    <box hexpand />

                    {/* Controls */}
                    <box valign={Gtk.Align.CENTER} spacing={10}>
                        <button class="player-strip-btn" onClicked={prevTrack}>
                            <label label="⏮" />
                        </button>
                        <button class="player-strip-btn player-strip-play" onClicked={togglePlayPause}>
                            <label label={playIcon} />
                        </button>
                        <button class="player-strip-btn" onClicked={nextTrack}>
                            <label label="⏭" />
                        </button>
                    </box>
                </box>
            </revealer>
        </window>
    )
}
