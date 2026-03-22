Полная документация и руководство по разработке AGS (Aylur's Gtk Shell)AGS использует синтаксис JSX для декларативного описания UI поверх GTK. Пользовательские компоненты пишутся с заглавной буквы (<MyComponent />), встроенные виджеты GTK — со строчной (<box />). Точкой входа приложения всегда является вызов app.start().1. Основы и Точка входаПриложение инициализируется через синглтон app.start(). Все ресурсы должны создаваться внутри функции main(), чтобы избежать проблем при работе в режиме клиента.import app from "ags/gtk4/app"

app.start({
  css: "./style.scss", // Подключение стилей
  main() {
    // Инициализация окон
    MyBar(0)
  },
})
2. Окна и ВиджетыКорневым виджетом всегда является <window>.Важно: В GTK4 окна по умолчанию невидимы. Обязательно используйте свойство visible.Для управления видимостью окна извне (через CLI), его нужно зарегистрировать, указав уникальное имя и передав объект app:// Свойство name должно идти строго перед application
<window name="Bar" application={app} visible>
  <box>Контент</box>
</window>
Пользовательские компоненты принимают один объект свойств (Props). Вложенные элементы передаются через специальное свойство children.3. Управление состоянием (Реактивность)Состояние базируется на сигналах (Accessors).createState(initial): Создает локальное изменяемое состояние. Возвращает кортеж [getter, setter].createBinding(object, property): Привязывается к свойствам объектов GObject (например, системных служб Astal).createComputed(fn): Создает производное реактивное значение.Синтаксическое сокращение: Геттер можно вызывать как функцию для трансформации значений (маппинга):const [count, setCount] = createState(0)
const labelText = count((c) => `Счет: ${c}`)
4. РендерингОтображение данных: Текст и переменные передаются в фигурных скобках {var}.Условный рендеринг: Используются тернарные операторы ? : или логическое &&. Ложные значения (falsy) не рендерятся.Динамический рендеринг (<With>): Для безопасной распаковки nullable-значений.Рендеринг списков (<For>): Динамический рендеринг массивов. Добавляет/удаляет только изменившиеся элементы.Важно: Оборачивайте <With> и <For> в контейнер (например, <box>), так как при перерисовке GTK нарушает порядок вставки виджетов.<box>
  <For each={list}>
    {(item, index) => <label label={index((i) => `${i}. ${item}`)} />}
  </For>
</box>
5. Системная интеграция и УтилитыТаймеры (ags/time)interval(ms, callback): Цикличное выполнение.timeout(ms, callback): Отложенное выполнение.idle(callback): Выполнение при простое.Опрос и процессы (ags/time, ags/process)createPoll(init, interval, callback): Создает сигнал, обновляемый по таймеру. Работает только при наличии подписчиков. Избегайте поллинга, если доступны сигналы.createSubprocess(init, exec): Запускает фоновый процесс при появлении подписчика и завершает при нуле.subprocess, execAsync: Запуск внешних команд. Синхронный exec блокирует UI, используйте execAsync.Команды запускаются "как есть". Для использования Bash: execAsync(["bash", "-c", "command"]).Файлы и Сетьags/file: readFile, readFileAsync, writeFile, writeFileAsync, monitorFile.ags/fetch: Встроенный fetch API.6. Взаимодействие через CLIПервый запуск app.start() создает основной процесс. Последующие запуски (например, через ags request) отправляют аргументы основному процессу.app.start({
  requestHandler(argv, response) {
    const [cmd, arg] = argv
    if (cmd === "toggle") {
       const bar = app.get_window("Bar")
       if (bar) bar.visible = !bar.visible
       return response("ok")
    }
    response("unknown command")
  },
  main() {}
})
7. Стилизация (Темизация)Темизация GTK осуществляется через CSS/SCSS.Подключайте статические файлы в app.start({ css: path }).Используйте классы. Свойство css на виджетах не каскадируется на дочерние элементы и его следует избегать.Применение в рантайме: app.apply_css(path_or_string), app.reset_css().8. Встроенные элементы (GTK4)<box orientation={Gtk.Orientation.HORIZONTAL | VERTICAL}><button onClicked={...}><centerbox>: Дочерние элементы должны иметь свойство $type="start" | "center" | "end".<drawingarea $={(self) => self.set_draw_func(...)}><entry onNotifyText={...} placeholderText="..." /><image file="..." iconName="..." pixelSize={16} /><label label="..." useMarkup wrap ellipsize={Pango.EllipsizeMode.END} /><menubutton>: Содержит кнопку и <popover>.<overlay>: Дочерние слои помечаются $type="overlay".<revealer transitionType={...} revealChild={...}><scrolledwindow>, <slider>, <stack>, <switch>, <togglebutton>.9. Продвинутые примеры архитектуры9.1 Панель состояния (Bar)Полноценный пример системной панели с использованием системных сервисов (батарея, Wi-Fi, звук, плеер).Bar.tsximport app from "ags/gtk4/app"
import GLib from "gi://GLib"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import AstalBattery from "gi://AstalBattery"
import AstalPowerProfiles from "gi://AstalPowerProfiles"
import AstalWp from "gi://AstalWp"
import AstalNetwork from "gi://AstalNetwork"
import AstalTray from "gi://AstalTray"
import AstalMpris from "gi://AstalMpris"
import AstalApps from "gi://AstalApps"
import { For, With, createBinding, onCleanup } from "ags"
import { createPoll } from "ags/time"
import { execAsync } from "ags/process"

function Mpris() {
  const mpris = AstalMpris.get_default()
  const apps = new AstalApps.Apps()
  const players = createBinding(mpris, "players")

  return (
    <menubutton>
      <box>
        <For each={players}>
          {(player) => {
            const [app] = apps.exact_query(player.entry)
            return <image visible={!!app.iconName} iconName={app?.iconName} />
          }}
        </For>
      </box>
      <popover>
        <box spacing={4} orientation={Gtk.Orientation.VERTICAL}>
          <For each={players}>
            {(player) => (
              <box spacing={4} widthRequest={200}>
                <box overflow={Gtk.Overflow.HIDDEN} css="border-radius: 8px;">
                  <image
                    pixelSize={64}
                    file={createBinding(player, "coverArt")}
                  />
                </box>
                <box valign={Gtk.Align.CENTER} orientation={Gtk.Orientation.VERTICAL}>
                  <label xalign={0} label={createBinding(player, "title")} />
                  <label xalign={0} label={createBinding(player, "artist")} />
                </box>
                <box hexpand halign={Gtk.Align.END}>
                  <button onClicked={() => player.previous()} visible={createBinding(player, "canGoPrevious")}>
                    <image iconName="media-seek-backward-symbolic" />
                  </button>
                  <button onClicked={() => player.play_pause()} visible={createBinding(player, "canControl")}>
                    <box>
                      <image iconName="media-playback-start-symbolic" visible={createBinding(player, "playbackStatus")((s) => s === AstalMpris.PlaybackStatus.PLAYING)} />
                      <image iconName="media-playback-pause-symbolic" visible={createBinding(player, "playbackStatus")((s) => s !== AstalMpris.PlaybackStatus.PLAYING)} />
                    </box>
                  </button>
                  <button onClicked={() => player.next()} visible={createBinding(player, "canGoNext")}>
                    <image iconName="media-seek-forward-symbolic" />
                  </button>
                </box>
              </box>
            )}
          </For>
        </box>
      </popover>
    </menubutton>
  )
}

function Tray() {
  const tray = AstalTray.get_default()
  const items = createBinding(tray, "items")

  const init = (btn: Gtk.MenuButton, item: AstalTray.TrayItem) => {
    btn.menuModel = item.menuModel
    btn.insert_action_group("dbusmenu", item.actionGroup)
    item.connect("notify::action-group", () => {
      btn.insert_action_group("dbusmenu", item.actionGroup)
    })
  }

  return (
    <box>
      <For each={items}>
        {(item) => (
          <menubutton $={(self) => init(self, item)}>
            <image gicon={createBinding(item, "gicon")} />
          </menubutton>
        )}
      </For>
    </box>
  )
}

function Wireless() {
  const network = AstalNetwork.get_default()
  const wifi = createBinding(network, "wifi")

  const sorted = (arr: Array<AstalNetwork.AccessPoint>) => {
    return arr.filter((ap) => !!ap.ssid).sort((a, b) => b.strength - a.strength)
  }

  async function connect(ap: AstalNetwork.AccessPoint) {
    try {
      await execAsync(`nmcli d wifi connect ${ap.bssid}`)
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <box visible={wifi(Boolean)}>
      <With value={wifi}>
        {(wifi) => wifi && (
          <menubutton>
            <image iconName={createBinding(wifi, "iconName")} />
            <popover>
              <box orientation={Gtk.Orientation.VERTICAL}>
                <For each={createBinding(wifi, "accessPoints")(sorted)}>
                  {(ap: AstalNetwork.AccessPoint) => (
                    <button onClicked={() => connect(ap)}>
                      <box spacing={4}>
                        <image iconName={createBinding(ap, "iconName")} />
                        <label label={createBinding(ap, "ssid")} />
                        <image iconName="object-select-symbolic" visible={createBinding(wifi, "activeAccessPoint")((active) => active === ap)} />
                      </box>
                    </button>
                  )}
                </For>
              </box>
            </popover>
          </menubutton>
        )}
      </With>
    </box>
  )
}

function AudioOutput() {
  const { defaultSpeaker: speaker } = AstalWp.get_default()!

  return (
    <menubutton>
      <image iconName={createBinding(speaker, "volumeIcon")} />
      <popover>
        <box>
          <slider widthRequest={260} onChangeValue={({ value }) => speaker.set_volume(value)} value={createBinding(speaker, "volume")} />
        </box>
      </popover>
    </menubutton>
  )
}

function Battery() {
  const battery = AstalBattery.get_default()
  const powerprofiles = AstalPowerProfiles.get_default()
  const percent = createBinding(battery, "percentage")((p) => `${Math.floor(p * 100)}%`)
  const setProfile = (profile: string) => powerprofiles.set_active_profile(profile)

  return (
    <menubutton visible={createBinding(battery, "isPresent")}>
      <box>
        <image iconName={createBinding(battery, "iconName")} />
        <label label={percent} />
      </box>
      <popover>
        <box orientation={Gtk.Orientation.VERTICAL}>
          {powerprofiles.get_profiles().map(({ profile }) => (
            <button onClicked={() => setProfile(profile)}>
              <label label={profile} xalign={0} />
            </button>
          ))}
        </box>
      </popover>
    </menubutton>
  )
}

function Clock({ format = "%H:%M" }) {
  const time = createPoll("", 1000, () => GLib.DateTime.new_now_local().format(format)!)
  return (
    <menubutton>
      <label label={time} />
      <popover><Gtk.Calendar /></popover>
    </menubutton>
  )
}

export default function Bar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  let win: Astal.Window
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  onCleanup(() => {
    win.destroy()
  })

  return (
    <window
      $={(self) => (win = self)}
      visible
      namespace="my-bar"
      name={`bar-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
    >
      <centerbox>
        <box $type="start">
          <Clock />
          <Mpris />
        </box>
        <box $type="end">
          <Tray />
          <Wireless />
          <AudioOutput />
          <Battery />
        </box>
      </centerbox>
    </window>
  )
}
9.2 Система уведомлений (AstalNotifd)Управление массивом объектов и обработка системных сигналов.Notification.tsximport Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import Adw from "gi://Adw"
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
import Pango from "gi://Pango"

function isIcon(icon?: string | null) {
  const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default()!)
  return icon && iconTheme.has_icon(icon)
}

function fileExists(path: string) {
  return GLib.file_test(path, GLib.FileTest.EXISTS)
}

function time(time: number, format = "%H:%M") {
  return GLib.DateTime.new_from_unix_local(time).format(format)!
}

function urgency(n: AstalNotifd.Notification) {
  const { LOW, NORMAL, CRITICAL } = AstalNotifd.Urgency
  switch (n.urgency) {
    case LOW: return "low"
    case CRITICAL: return "critical"
    case NORMAL: default: return "normal"
  }
}

interface NotificationProps {
  notification: AstalNotifd.Notification
}

export default function Notification({ notification: n }: NotificationProps) {
  return (
    <Adw.Clamp maximumSize={400}>
      <box widthRequest={400} class={`Notification ${urgency(n)}`} orientation={Gtk.Orientation.VERTICAL}>
        <box class="header">
          {(n.appIcon || isIcon(n.desktopEntry)) && (
            <image class="app-icon" visible={Boolean(n.appIcon || n.desktopEntry)} iconName={n.appIcon || n.desktopEntry} />
          )}
          <label class="app-name" halign={Gtk.Align.START} ellipsize={Pango.EllipsizeMode.END} label={n.appName || "Unknown"} />
          <label class="time" hexpand halign={Gtk.Align.END} label={time(n.time)} />
          <button onClicked={() => n.dismiss()}><image iconName="window-close-symbolic" /></button>
        </box>
        <Gtk.Separator visible />
        <box class="content">
          {n.image && fileExists(n.image) && <image valign={Gtk.Align.START} class="image" file={n.image} />}
          {n.image && isIcon(n.image) && (
            <box valign={Gtk.Align.START} class="icon-image">
              <image iconName={n.image} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} />
            </box>
          )}
          <box orientation={Gtk.Orientation.VERTICAL}>
            <label class="summary" halign={Gtk.Align.START} xalign={0} label={n.summary} ellipsize={Pango.EllipsizeMode.END} />
            {n.body && (
              <label class="body" wrap useMarkup halign={Gtk.Align.START} xalign={0} justify={Gtk.Justification.FILL} label={n.body} />
            )}
          </box>
        </box>
        {n.actions.length > 0 && (
          <box class="actions">
            {n.actions.map(({ label, id }) => (
              <button hexpand onClicked={() => n.invoke(id)}>
                <label label={label} halign={Gtk.Align.CENTER} hexpand />
              </button>
            ))}
          </box>
        )}
      </box>
    </Adw.Clamp>
  )
}
NotificationPopups.tsximport app from "ags/gtk4/app"
import { Astal, Gtk } from "ags/gtk4"
import AstalNotifd from "gi://AstalNotifd"
import Notification from "./Notification"
import { createBinding, For, createState, onCleanup } from "ags"

export default function NotificationPopups() {
  const monitors = createBinding(app, "monitors")
  const notifd = AstalNotifd.get_default()
  const [notifications, setNotifications] = createState(new Array<AstalNotifd.Notification>())

  const notifiedHandler = notifd.connect("notified", (_, id, replaced) => {
    const notification = notifd.get_notification(id)
    if (replaced && notifications.get().some((n) => n.id === id)) {
      setNotifications((ns) => ns.map((n) => (n.id === id ? notification : n)))
    } else {
      setNotifications((ns) => [notification, ...ns])
    }
  })

  const resolvedHandler = notifd.connect("resolved", (_, id) => {
    setNotifications((ns) => ns.filter((n) => n.id !== id))
  })

  onCleanup(() => {
    notifd.disconnect(notifiedHandler)
    notifd.disconnect(resolvedHandler)
  })

  return (
    <For each={monitors}>
      {(monitor) => (
        <window
          $={(self) => onCleanup(() => self.destroy())}
          class="NotificationPopups"
          gdkmonitor={monitor}
          visible={notifications((ns) => ns.length > 0)}
          anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
        >
          <box orientation={Gtk.Orientation.VERTICAL}>
            <For each={notifications}>
              {(notification) => <Notification notification={notification} />}
            </For>
          </box>
        </window>
      )}
    </For>
  )
}
9.3 Applauncher (Меню запуска)Обработка клавиатуры (EventControllerKey), кликов вне зоны контента (GestureClick + Graphene) и нечеткий поиск.Applauncher.tsximport { For, createState } from "ags"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import AstalApps from "gi://AstalApps"
import Graphene from "gi://Graphene"

const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

export default function Applauncher() {
  let contentbox: Gtk.Box
  let searchentry: Gtk.Entry
  let win: Astal.Window

  const apps = new AstalApps.Apps()
  const [list, setList] = createState(new Array<AstalApps.Application>())

  function search(text: string) {
    if (text === "") setList([])
    else setList(apps.fuzzy_query(text).slice(0, 8))
  }

  function launch(app?: AstalApps.Application) {
    if (app) {
      win.hide()
      app.launch()
    }
  }

  function onKey(_e: Gtk.EventControllerKey, keyval: number, _: number, mod: number) {
    if (keyval === Gdk.KEY_Escape) {
      win.visible = false
      return
    }

    if (mod === Gdk.ModifierType.ALT_MASK) {
      for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
        if (keyval === Gdk[`KEY_${i}`]) return launch(list.get()[i - 1])
      }
    }
  }

  function onClick(_e: Gtk.GestureClick, _: number, x: number, y: number) {
    const [, rect] = contentbox.compute_bounds(win)
    const position = new Graphene.Point({ x, y })

    if (!rect.contains_point(position)) {
      win.visible = false
      return true
    }
  }

  return (
    <window
      $={(ref) => (win = ref)}
      name="launcher"
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      onNotifyVisible={({ visible }) => {
        if (visible) searchentry.grab_focus()
        else searchentry.set_text("")
      }}
    >
      <Gtk.EventControllerKey onKeyPressed={onKey} />
      <Gtk.GestureClick onPressed={onClick} />
      <box
        $={(ref) => (contentbox = ref)}
        name="launcher-content"
        valign={Gtk.Align.CENTER}
        halign={Gtk.Align.CENTER}
        orientation={Gtk.Orientation.VERTICAL}
      >
        <entry $={(ref) => (searchentry = ref)} onNotifyText={({ text }) => search(text)} placeholderText="Start typing to search" />
        <Gtk.Separator visible={list((l) => l.length > 0)} />
        <box orientation={Gtk.Orientation.VERTICAL}>
          <For each={list}>
            {(app, index) => (
              <button onClicked={() => launch(app)}>
                <box>
                  <image iconName={app.iconName} />
                  <label label={app.name} maxWidthChars={40} wrap />
                  <label hexpand halign={Gtk.Align.END} label={index((i) => `󰘳${i + 1}`)} />
                </box>
              </button>
            )}
          </For>
        </box>
      </box>
    </window>
  )
}

