import { For } from "ags"
import { execAsync } from "ags/process"
import { createState } from "ags"
import { focusedIdx } from "./NiriEvents"

const TOTAL_WORKSPACES = 10
const HANZI = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
const fixedWorkspaces = Array.from({ length: TOTAL_WORKSPACES }, (_, i) => i + 1)
const [wsList] = createState(fixedWorkspaces)

export default function Workspaces() {
    return (
        <box class="island workspaces" spacing={2}>
            <For each={wsList}>
                {(idx: number) => {
                    const cls = focusedIdx((f) =>
                        f === idx ? "ws-btn focused" : "ws-btn"
                    )
                    return (
                        <button
                            class={cls}
                            onClicked={() =>
                                execAsync(`niri msg action focus-workspace ${idx}`).catch(() => {})
                            }
                        >
                            <label label={HANZI[idx - 1]} />
                        </button>
                    )
                }}
            </For>
        </box>
    )
}
