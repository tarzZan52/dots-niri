import { createPoll } from "ags/time"
import GLib from "gi://GLib"

const time = createPoll("--:--", 1000, () => {
    try {
        const dt = GLib.DateTime.new_now_local()
        return dt ? (dt.format("%H:%M") || "--:--") : "--:--"
    } catch {
        return "--:--"
    }
})

const date = createPoll("", 1000, () => {
    try {
        const dt = GLib.DateTime.new_now_local()
        return dt ? (dt.format("%a, %d %b") || "") : ""
    } catch {
        return ""
    }
})

export default function Clock() {
    return (
        <box class="island clock" spacing={8}>
            <label class="clock-date" label={date} />
            <label class="clock-time" label={time} />
        </box>
    )
}
