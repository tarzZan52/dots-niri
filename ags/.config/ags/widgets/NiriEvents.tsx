import { createState } from "ags"
import { exec, subprocess } from "ags/process"

// ── Types ───────────────────────────────────────────────────────────────────

interface NiriWorkspace {
    id: number
    idx: number
    name: string | null
    output: string
    is_active: boolean
    is_focused: boolean
    active_window_id: number | null
}

interface KbLayouts {
    names: string[]
    current_idx: number
}

// ── Keyboard Layout ─────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
    "English (US)": "us",
    "Russian": "ru",
    "Ukrainian": "ua",
    "German": "de",
    "French": "fr",
    "Spanish": "es",
    "Japanese": "jp",
    "Chinese": "cn",
    "Korean": "kr",
    "Portuguese": "pt",
    "Italian": "it",
    "Polish": "pl",
    "Czech": "cz",
    "Turkish": "tr",
}

function getShortName(name: string): string {
    return LANG_MAP[name] || name.slice(0, 2).toLowerCase()
}

function fetchLayouts(): KbLayouts {
    try {
        return JSON.parse(exec("niri msg -j keyboard-layouts"))
    } catch {
        return { names: [], current_idx: 0 }
    }
}

const initKb = fetchLayouts()

export const [layoutName, setLayoutName] = createState(
    initKb.names.length > 1 ? getShortName(initKb.names[initKb.current_idx]) : ""
)
export const multiLayout = initKb.names.length > 1

// ── Workspaces ──────────────────────────────────────────────────────────────

function fetchFocused(): number {
    try {
        const ws: NiriWorkspace[] = JSON.parse(exec("niri msg -j workspaces"))
        const f = ws.find((w) => w.is_focused)
        return f ? f.idx : 1
    } catch {
        return 1
    }
}

export const [focusedIdx, setFocusedIdx] = createState(fetchFocused())

// ── Single event stream ─────────────────────────────────────────────────────

subprocess("niri msg -j event-stream", (line) => {
    try {
        const event = JSON.parse(line)

        if (event.KeyboardLayoutsChanged) {
            const kb: KbLayouts = event.KeyboardLayoutsChanged.keyboard_layouts
            if (kb.names.length > 1) {
                setLayoutName(getShortName(kb.names[kb.current_idx]))
            }
        }

        if (event.KeyboardLayoutSwitched) {
            const idx: number = event.KeyboardLayoutSwitched.idx
            setLayoutName(getShortName(initKb.names[idx] || `${idx}`))
        }

        if (event.WorkspaceActivated) {
            try {
                const ws: NiriWorkspace[] = JSON.parse(exec("niri msg -j workspaces"))
                const activated = ws.find((w) => w.id === event.WorkspaceActivated.id)
                if (activated) setFocusedIdx(activated.idx)
            } catch {}
        }

        if (event.WorkspacesChanged) {
            const ws: NiriWorkspace[] = event.WorkspacesChanged.workspaces
            const focused = ws.find((w) => w.is_focused)
            if (focused) setFocusedIdx(focused.idx)
        }
    } catch {}
})
