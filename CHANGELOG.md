# Changelog

All notable user-visible changes to Lumora are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Lumora uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Keep a page's toolbar in reach. On **Workspaces**, **All sessions**, a
  workspace page, **Settings** and **Remote computers**, the toolbar stays under
  the top bar while the page scrolls beneath it, so search, filters, **Back**
  and the settings categories no longer scroll away. The page title fades as it
  leaves and the top bar shows the page's name instead. The search shortcut
  puts you in search without moving the list, and another settings category
  opens under categories that stay pinned rather than back at the top of the
  page. **Remote computers** no longer repeats its title and description under
  the page's own.

## [0.6.4] - 2026-09-18

### Added

- Know when a session finishes or needs you. When a session you aren't watching
  finishes, stops with an error or waits on an approval or a question, its tile
  under **Running sessions** and its tab get a dot in your theme's colours, a
  tip offers to open it, and an optional chime plays. Unified UI sessions report
  from their own events. Claude Code and Codex terminals report through hooks
  Lumora adds to that one launch, without touching `~/.claude` or `~/.codex`,
  and your own Codex `notify` keeps running. Other agents are marked when they
  ring the terminal bell or print a desktop notification. Each cue can be
  turned off under **Settings → General → Session status**; the chime starts
  off.
- See which sessions are at work. The same place on a session's tile and tab
  shows a spinner in your theme's accent while its agent works: for Unified UI
  sessions, Claude Code terminals, and Codex terminals once you have trusted
  Lumora's hooks in Codex's `/hooks`. A request for you that you haven't seen
  still comes first. Other terminals show no spinner, since nothing says when
  those agents start working.
- Lumora's helper moves to 0.6.0, which carries those hooks' reports, so each
  remote computer asks you to install it once, the next time you connect.

### Fixed

- Open the terminal of a running session from Home straight away. Selecting a
  session just as Home first showed it running could start the launch flow for
  it instead of showing the terminal it was already running in, because the
  page and what a click reads were brought up to date one after the other. They
  now change together.

## [0.6.3] - 2026-09-18

### Changed

- Change the mode and the model while the agent works. Both pickers were held
  until the turn ended, so a session could not be put into plan mode or moved
  onto another model without waiting or stopping the agent, which a terminal
  never asked for. Both are settings the agent reads for what it does next, and
  each provider takes them beside the conversation rather than in it, so they
  are sent straight away and recorded inside the turn under way.

### Fixed

- Dress every dialog in the window's appearance. The dialog behind Home's
  needs-attention card and both provider details dialogs were rendered outside
  the appearance root, so the transparency a background picture gives every
  other surface never reached them and they stayed opaque over it.

## [0.6.2] - 2026-09-17

### Fixed

- List a Unified UI session once. A session opened in the Unified UI appeared
  under both **Running sessions** and **Recent sessions** in the sidebar,
  because only native terminal runtimes were taken out of the recent list.
- Keep the conversation in place while reading earlier messages in the Unified
  UI. The view showed a window of the newest turns, so every answer the agent
  gave while you were reading history pushed an older turn off the top: the
  messages you had scrolled up for disappeared and the view lost its place. The
  window now holds the turn you scrolled back to, and lets the extra history go
  once you return to the latest message.

## [0.6.1] - 2026-09-16

### Added

- Four shortcuts for buttons that had none. `Ctrl+Shift+N` opens the new
  session dialog, from any page and while a session is in front.
  `Ctrl+Shift+M` maximizes or restores the changes panel. `Ctrl+Shift+R`
  refreshes what is in front: the changes panel when one is open, otherwise
  Workspaces, All Sessions, a workspace's session list, or Diagnostics.
  `Ctrl+F` puts the cursor in the search field on Workspaces and All Sessions.
  All four can be changed under **Settings > Keyboard**, and a shortcut nothing
  can answer is passed on to the agent rather than swallowed.

### Changed

- Close any dialog with `Escape`. Eleven dialogs, among them **New session**,
  the session details, the transfer dialogs and the remote profile and
  installation dialogs, could only be closed with their close button. Escape
  now answers the layer in front, so a menu opened inside a dialog closes on
  its own first, and a dialog busy with work it cannot abandon still ignores
  the key.
- Buttons that a shortcut works now say so in their tooltip, including
  **Changes**, **New session**, **Maximize changes** and the refresh buttons.
- **Changes** is now the branch mark source control wears in an editor, with
  the number of changed files as a badge on its corner, and **Back to
  workspaces** and **Back to history** are a left arrow. Each keeps its name in
  its tooltip. A step back inside a dialog keeps its word, since it stands
  among worded choices.
- Stop ringing the whole page when a dialog closes. A dialog rendered inside
  the page hands focus back to it, and the page was drawn as though it were a
  control.

### Fixed

- Open the session the tray asked for. Choosing a running session from the tray
  soon after the window opened could start the launch flow for it instead of
  showing the terminal it was already running in, because the tray was holding
  a callback made before Lumora knew what was running. It now reads what is
  running when the tray asks.
- Offer **New session** everywhere. The button appeared only on Home and
  Workspaces, and a native terminal session hid it while a Unified UI session
  did not, so where it could be found depended on the route a session had
  taken. It now sits in the top bar on every page and alongside a running
  session, as `Ctrl+Shift+N` already did.
- Stop the changes panel from taking the keyboard. Opening it, closing it,
  coming back from a reviewed batch, and revealing more files each moved focus
  onto a button, so `Ctrl+Shift+G` left a focus ring on the panel's **Close**
  button and `Escape` left one on **Changes**. The panel now leaves focus where
  it was, and the terminal or the composer keeps it. Arrow keys still move
  between files once you select one.

## [0.6.0] - 2026-09-16

### Added

- Review what an agent changed without leaving Lumora. **Changes** in a
  session header counts the files changed in that workspace since the session
  started and opens a panel beside the session with the list and each file's
  diff. **This session** shows the work of that session, **All uncommitted**
  everything that differs from the last commit, and **Mark reviewed** clears
  the files you have read and files them under **History**, where past
  sessions and their reviewed batches stay. A file can be opened, shown in its
  folder, or have either its workspace path or its full path copied; a program
  is always shown in its folder rather than run, and a script asks first.
  **Ctrl+Shift+G** shows or hides the panel and can be rebound in
  **Settings > Keyboard**. Lumora reads the workspace with git and writes its
  snapshots to its own data folder, so nothing is committed, staged, or
  changed on disk, and a workspace's snapshots are removed 14 days after its
  last session ended. Sessions on this computer only, for now.

## [0.5.14] - 2026-09-15

### Changed

- Keep **Recent events** in **Diagnostics** short. The page lists the ten
  newest events, and **Event details** opens the 100 most recent in a
  fixed-size window that scrolls, each with every field it recorded: time,
  severity, outcome, target, provider, code, duration, counts, and correlation
  ID.

### Fixed

- Play the startup animation once, without a blink at the end. The window first
  showed the animation's final frame and then started the video from the
  beginning, and when the video ended it was replaced by that frame as an image
  that faded in again. The video now starts on its own first frame and stays on
  its last one; the image is shown only if the video cannot play.
- Delete a remote computer that has been connected before. Lumora keeps the
  workspaces, sessions, and terminal profiles it found on a remote computer,
  and deleting the computer did not remove them first, so any computer that had
  ever been scanned failed with **Lumora could not delete this remote
  computer**, connected or not. Deleting now removes that stored data along with
  the computer; nothing on the remote computer itself is touched.

## [0.5.13] - 2026-09-14

### Fixed

- Open a session in Unified UI without waiting on other agents. Every launch
  asked each installed Unified UI agent what it supports, starting Codex and
  the ACP agents to do so, and asked again once the answers were five minutes
  old, so a session could stay on **Starting** for 15 seconds to a minute. A
  launch now checks only its own agent, a verified answer stands until that
  agent's installation changes, and agents you opened in Unified UI recently
  are checked in the background shortly after Lumora starts.
- Keep one slow provider from holding up the rest. When a provider's version
  check failed, every provider was scanned again ten seconds later, and
  launching the provider whose check failed was refused in the meantime. A
  failed check is now tried once more, only that provider is scanned again, a
  launch asks again before refusing, and the diagnostic journal names the
  provider and whether its check timed out.
- Start a new terminal session without scanning every provider first. Before a
  new session, fork, or handoff could open, Lumora refreshed the sessions of
  every enabled provider, which could take several seconds with Codex or
  OpenCode installed, and Unified UI launches waited for it too. A terminal
  launch now reads only its own provider's sessions as the terminal starts,
  and Unified UI launches skip it.
- Keep dropdown lists against the control that opened them. A list that opened
  upward, such as the **Mode** and model pickers in Unified UI, started where a
  full-height list would have and floated above a picker with only a few
  choices, and every list was exactly as wide as its control, so longer names
  wrapped. Lists now rest on their control and widen to fit their choices, and
  the model list lines up with the right edge of its picker.
- Match the Unified UI **Mode** picker to the model picker. It was taller and
  set in different type; both now share one size and type.
- Centre the arrow on every dropdown, and turn it to point up while the list is
  open.

## [0.5.12] - 2026-09-14

### Added

- See every process behind Lumora and its agents. **Process details** in
  **Diagnostics** lists each Lumora process, and each running agent with the
  processes it started, such as the commands it runs, with memory and CPU for
  every one. The list updates every two seconds while it is open. Process
  names and session titles stay on screen and never go into a diagnostic
  export.

### Fixed

- Keep **Diagnostics** figures current. Working set, CPU, and process count
  took one reading when the page opened and then stood still; they now update
  every two seconds while the page is open, pause while the window is hidden,
  and lead the page ahead of the storage locations. CPU shows **Measuring…**
  until it has a recent reading, rather than an average since the page was last
  opened.

### Changed

- Lumora's helper moves to version 0.5.0. A remote computer asks to install the
  new helper the next time it connects, the same confirmation as a first
  install.

## [0.5.11] - 2026-09-13

### Added

- Answer an agent's questions in the unified interface. When Codex asks which
  option you want, when Claude Code puts a multiple-choice question to you, or
  when an MCP server needs a short form or a sign-in page, the question appears
  in the conversation with its choices, a place to type, or a link to open.
  Answers go only to the agent: the conversation notes that a question was
  answered or declined, never what you answered, and a secret field hides what
  you type. A question the agent no longer needs closes on its own.
- Switch how an agent works from the message box. A **Mode** picker beside the
  attach button offers Codex's **Default** and **Plan**, Claude Code's
  **Default**, **Accept edits** and **Plan**, and whatever modes an ACP agent
  such as Gemini CLI advertises. It follows the agent when the agent changes
  mode itself, such as Claude leaving plan mode once a plan is approved. Lumora
  never switches Claude into bypassing permissions.
- Keep writing while an agent works. Codex takes a message into the turn under
  way, shown beneath the prompt as sent while it was working. Claude Code and
  ACP agents take one message at a time, so the unified interface holds yours
  above the message box and sends it when the turn ends, including when you
  stop the turn to redirect the agent. A waiting message can be removed, and
  several go one turn at a time. Send and Stop now sit side by side during a
  turn.
- Show Claude Code's to-do list as the plan checklist in the unified interface,
  the way Codex's plan already appears, instead of a row saying Claude used its
  to-do tool. A resumed session shows the plan as it stood, a subagent's own
  to-do list stays with that subagent's work, and Claude compacting its context
  now shows in the process as Codex's does.

### Fixed

- Stop a question from an agent ending its turn. Codex's requests for input,
  for an MCP form, and for extra permissions were refused, so the agent failed
  without saying why. Claude Code's questions appeared as a permission to allow
  or deny with no way to answer them, and a form an MCP server asked Claude for
  was declined without being shown. Each is now shown and answered, and Codex's
  permission requests use the approval buttons its commands already use.
- Say why an agent's turn failed. An error from Codex was replaced with a
  generic line, and a Claude Code turn that failed — at a usage limit, say —
  showed only **Failed**. The unified interface now names the kind of problem
  in your language, shows the agent's own words beneath it, counts retry
  attempts while the agent tries again, and shows when a usage limit resets.
  An error clears itself once the agent is heard from again, not when a command
  such as `/status` runs, and a turn you stop is no longer reported as a failure.
- Leave Codex's plan mode. `/plan` switched a session into plan mode with no way
  back out short of starting a new session; the mode picker now switches back to
  **Default**, and `/permissions` shows which permission profile is in use.
- Keep Codex's subscription limits current in **Session details**. Codex
  reports its limits as they change, and those reports were ignored, so the
  details showed only what was read when they were last opened.

## [0.5.10] - 2026-09-12

### Added

- Send images to an agent in the unified interface. Paste a screenshot, drop
  a picture on the message box, or pick one from the new attach control at the
  left of the message box. Up to eight go with a message, and an image can be
  sent without any text. Lumora
  scales each one to at most 2048 pixels on its longest side and sends it as
  PNG, or as JPEG when a photo would be too large, so a phone photo does not
  exhaust the agent's context. Codex, Claude and any ACP agent that says it
  reads images (such as Gemini) accept them; the button stays hidden for an
  agent that does not. The conversation notes how many images a message
  carried.
- Point an agent at files from the unified interface. The attach control offers
  files to every session, and the message box takes dropped files. A file
  travels as its path, which is what an agent needs: it reads files itself, so
  it can open what it needs and search a large one instead of being handed the
  whole thing. Up to
  eight files go with a message, and a message can be files alone. The paths
  are part of the message, so the conversation shows what the agent was told.

### Security

- Refuse every web permission Lumora's windows ask for. With no rule of its own,
  Electron granted Lumora's pages the microphone, camera, location,
  notifications and clipboard without asking anyone — measured in the running
  app. Lumora needs none of them, because its clipboard already goes through
  the main process. Every request is now refused, in every window, including
  windows a later feature might open in a session of its own.

## [0.5.9] - 2026-09-11

### Fixed

- Show a loading mark while a button works instead of turning its own. A
  refresh, update or install in progress spun its icon, so a pair of
  chevrons or a download arrow turned in place and read as the action
  repeating rather than as waiting. The button now shows the ring with one
  bright arc that Lumora's other spinners already draw, in place of its own
  mark, and keeps its name. With reduced motion the ring holds still, and
  still reads as waiting because it is a different mark rather than the same
  one at rest.
- Show that work is running on the refresh buttons that gave no sign of it:
  diagnostics, terminal profiles, theme packs, font presets and language
  packs. Terminal profiles could also be refreshed again while a refresh was
  still running; that button now waits for the first one to finish.
- Say what a working button is doing in its tooltip. While a provider
  updated, the tooltip on its update button still offered to start the
  update; it now reads **Updating Codex**. Installing does the same, and so
  does every refresh and reload while it runs: **Checking providers and their
  latest versions…**, **Scanning sessions…**, **Loading diagnostics…** and
  the rest. The button keeps its name for screen readers, which already hear
  that it is busy, and a tooltip that is already open takes the new text in
  place rather than closing and waiting to reopen.
- Keep a long tooltip on one line near the edge of the window. A tooltip was
  measured where the previous one had been shown, and near the right edge a
  bubble wraps into the room it has left, so a longer label measured narrow,
  came out on two lines and ended flush against the window with no margin.
  It is now measured with the whole window free, then placed.

## [0.5.8] - 2026-09-09

### Changed

- Offer **Detailed settings** under **Unified agent interface** only while the
  master switch is on. Everything inside it applies to an interface that is
  turned off, and opening it launched every installed agent to ask what it
  supports. With the switch off, nothing behind it runs at all.
- Check the installed interfaces against the discovery Lumora already has
  rather than repeating it, and ask only the providers that are turned on for
  the unified interface. Opening **Detailed settings** re-detected every
  provider first, so the list took about two seconds to appear every time; it
  now opens from what the provider cards are already showing, and **Check
  interfaces** remains the way to look again from scratch. Choosing Unified UI
  for one session still asks that provider, whatever its automatic preference
  says.
- Open every folder from one mark. **Open Mods folder**, the theme pack, font
  preset and language pack folders under **Settings → Mods**, and **Open themes
  folder** under **Settings → Appearance** are now a folder icon with the full
  name in a tooltip. The row already names the folder and shows its path, and
  the mark is drawn as a folder rather than the arrow that means going to
  something inside Lumora.
- Turn the **Unified agent interface** off by default. A new install now runs
  every agent in the native terminal until you turn the master switch on under
  **Settings → Providers**. Anyone who has already made a choice keeps it; only
  settings that never carried the switch take the new default.
- Group a row's marks together and its words together, with a wider gap where
  the two meet. A mark set between two labels read as punctuation between them
  rather than as a control of its own; **Workspaces** and the theme pack row
  both did this.
- Tell installing and updating apart on a provider card. Fetching a provider
  that is not here yet is a downward arrow; raising one that is already here to
  a newer version is a pair of upward chevrons. **Install** is now its mark
  alone, like the rest.
- Reduce the action a card or a row is there for to its mark. **Update
  available**, **Open** on a remote computer, and **Resume** on a recent session
  are now an icon with the name in a tooltip. Updating and opening keep their
  accent, so the thing worth doing is still the thing you see first, and a card
  with nothing to update simply has no accent on it. A session already running
  shows the going-to mark rather than the starting one, and each names its own
  session, so a screen reader hears "Resume Catalog implementation" rather than
  a row of identical "Resume"s.
- Open a provider card's, a terminal's and a Unified UI session's detail from
  the same mark. All three said **Details** in three different wordings; they
  now carry one icon, which also gives a provider card back the width its
  update button was competing for.
- Fold **Check for updates** into **Refresh** on **Settings → Providers**. They
  were two buttons doing halves of one job, and checking for releases against a
  stale scan reports on versions you may no longer have installed. Refreshing
  now re-probes the providers and then checks their releases, in that order.
- Replace the word on a repeated utility action with the icon for what it
  does. Reloading a list — the catalog on **Workspaces** and **All sessions**, a
  workspace's own sessions, diagnostics, terminal profiles, theme packs, font
  presets, language packs, the developer environment and its remote twin, the
  provider registry — is a circular arrow in the header instead of a button
  spelling it out, and a remote computer's row carries a pencil and a bin rather
  than **Edit** and **Delete**. A refresh that is running turns its arrow while
  it works; its name stays put, so it is still the same button to come back to. Each keeps its full name in a
  tooltip and for screen readers, so a row still says "Delete *name*" rather
  than "Delete". Buttons that finish a flow, that sit among worded choices, or
  that name which of several folders they open keep their words.
- Draw every cross the same way. A session warning was dismissed with a typed
  × character, which took its weight from whichever font was loaded and never
  matched the stroked icons beside it. It now uses the same drawn cross as a
  dialog's close control.
- Close a dialog with a cross instead of the word **Close**. Every dialog
  header now carries the same small cross in its corner, with the name of what
  it closes in a tooltip rather than on the button. The header keeps the same
  width in every language, and screen readers still hear the full name — "Close
  Unified UI settings" rather than a bare "Close". The **Close** in a footer
  row, where it sits beside other worded actions, stays a word.

### Fixed

- Stop a provider that is not installed from shortening the detection cache.
  A scan that missed anything was kept for ten seconds instead of five minutes,
  so on a machine where any enabled provider is absent — an agent you have not
  installed, and never intend to — every reader of that cache paid for a fresh
  scan of the filesystem. Only a provider whose version probe *failed* now
  shortens the term, because that is the miss that can correct itself; one that
  is simply not installed will not appear ten seconds later.
- Stop a slow Windows machine from losing the providers npm installed. Reading
  npm's global prefix runs through the same `.cmd` bridge as a version probe,
  which pays PowerShell's startup before npm begins, and it was given two
  seconds — a budget a cold or loaded machine can exceed. When it expired the
  npm global directory was dropped from the search paths, and the providers
  installed there were reported as not found. It now gets the four seconds a
  version probe already had.
- Stop a provider process outliving Lumora on Windows. An agent installed by
  npm is started through a `.cmd` shim, so Lumora was ending the shim and
  leaving the agent it had launched running. A capability check that failed or
  timed out left an agent process resident until the machine was restarted.
  Ending a provider now takes down everything it started.

## [0.5.7] - 2026-09-08

### Fixed

- Stop terminals resizing when you switch between them. Lumora keeps every
  terminal mounted and hides the ones you switch away from, and revealing one
  refitted it — resizing the terminal, repainting it and telling the agent its
  size, all to reach the shape it already had. A terminal is now measured only
  when its box has actually changed, so switching costs nothing and shows no
  resize. When the box did change, because the window was resized while you
  were on another terminal, the correction is applied before the frame is
  drawn rather than after it.
- Stop a hidden terminal collapsing to five rows. A terminal that is not
  displayed reports its height as the literal `100%` rather than a pixel value,
  which the fit read as 100px. The agent was told it had five rows to draw in,
  so a full-screen agent reflowed its whole display every time you left it.

## [0.5.6] - 2026-09-07

### Changed

- Move the detail out of the **Needs attention** card on Home. The card named
  each kind of problem and listed the lost runtimes under it, so it grew every
  time one appeared. It now carries the count alone, with a **View details**
  entry beneath it that opens a dialog holding each catalog issue, what it
  affects and how to clear it, and every lost runtime with its recovery action.
  The catalog issues were not visible anywhere before.

### Fixed

- Stop an abandoned session from resuming. Clicking one session and immediately
  clicking another started both: only a launch for the *same* session was
  cancelled, so the first one's start finished after the user had moved on and
  opened a terminal they had already clicked away from. Any launch still in
  flight is now superseded, and a runtime that arrives after its launch was
  superseded is closed.

## [0.5.5] - 2026-09-05

### Changed

- Rebuild **Settings → Providers** around one card per provider. A card carries
  the version, a switch to turn the provider on or off, an update button when
  there is one, and a **Details** button. Details holds the detected command,
  the installed path, the release state and the custom start command. The
  separate list of enabled providers is gone, because the switch replaces it and
  applies at once. Every provider Lumora supports keeps a card even when it is
  turned off, so it can always be turned back on. The update button reads
  **Update available**; the version it moves to is named in the confirmation.
- Confirm a provider install or update in a dialog instead of inside the
  provider card. The confirmation used to replace the action button with a
  warning and two more buttons, pushing every provider below it down the page.
- Collapse the sections of **Settings → Appearance**. Theme packs, message
  colors, fonts and the workspace image each fold to their heading, showing
  their current value beside it, and the choice is remembered. The color theme
  stays visible, and an open section keeps its controls on the page so a live
  preview still shows through.

### Fixed

- Make **Refresh** on **Settings → Providers** actually re-scan. It answered
  from a five-minute cache, so a provider that failed to be detected once
  stayed marked missing and the button returned at once as though nothing had
  happened. A scan the user asks for now re-probes every time.
- Let a provider scan that missed something expire after ten seconds instead of
  five minutes, so a detection that failed for a passing reason corrects itself
  rather than sticking for the rest of the session.
- Give a provider ten seconds to report its version instead of five. Measured
  on Windows while idle, gemini takes 2.6-2.8s and copilot 2.3-2.4s to answer,
  which left too little room on a busy machine and turned a working provider
  into a probe failure.
- Record what each provider scan found in the diagnostic journal, and log a
  scan that missed a provider as a warning. A scan that returned but detected
  nothing used to be recorded as a plain success.
- Hold the column widths in **All sessions**. The table re-measured itself
  against its contents, so every refresh and every **Load more** shifted the
  columns under the pointer. The widths now come from the header alone: they
  still follow the window, but no longer the rows. A value too long for its
  column is cut with an ellipsis instead of wrapping, so row heights hold as
  well.

## [0.5.4] - 2026-09-04

### Added

- Choose the terminal text size under **Settings → Appearance**, beside the
  terminal font. Agent interfaces that drew too small can be made readable, and
  the change reaches terminals that are already open, local and remote, without
  reopening them. Larger text leaves fewer columns, so a wide interface wraps
  sooner.
- Cancel a provider update while it runs. **Cancel update** stops the npm
  process Lumora started, including the processes it spawned underneath, rather
  than only clearing the progress indicator. Lumora re-reads the provider
  afterwards, because stopping an install partway can leave a different version
  on disk than the one shown. Cancelling is reported as an outcome rather than
  a failure, so it no longer prints an error in the application log.

### Fixed

- Explain why a provider update failed instead of reporting a generic error.
  npm replaces a global package by moving the installed one aside first, and on
  Windows a running provider's files cannot be moved, so updating a provider
  while it was in use both failed and left the installation half-replaced.
  Lumora now recognises that failure and asks you to close the running sessions
  first. npm's own output is still never shown, because it can carry registry
  credentials.
- Stop the terminal slicing its last line. The terminal fitted a grid slightly
  taller than its container shows, so the bottom line of an agent's status bar
  was cut off by the edge. The overflow now comes out of the inset below the
  terminal, which keeps every row and leaves the terminal reaching the bottom of
  its container as before.

## [0.5.3] - 2026-09-03

### Fixed

- Give the session loading screen Lumora's own buttons. **Try again** and
  **Trust and continue** were styled with a class the stylesheet never defined,
  so they appeared as plain grey system buttons instead of Lumora controls. The
  approval buttons in the unified agent view had the same problem.
- Count agents running in the Unified UI as running agents. The **Running
  agents** card on the home view and the **Active agents** figure in
  Diagnostics both counted only agents running in a native terminal, so an
  agent working in Lumora's own interface showed up nowhere in those totals.
  The status bar, the tray menu and the quit warning already counted both.
- List a Unified UI session in **Running sessions** while it is still starting.
  Resuming into the Unified UI left the session missing from the running list,
  the status bar and the home count until the provider finished connecting,
  unlike a terminal resume, which appears as soon as it starts.
- Scroll dialogs whose content is taller than the window. **Session details**
  and every other Lumora dialog cut their content off at the bottom edge with
  no scrollbar, hiding the rest of the page and, in dialogs that have one, the
  row of action buttons. Short dialogs are unchanged.
- Keep the Ctrl+Tab terminal switcher on screen. With about a dozen or more
  terminals open it grew past the bottom of the window, taking the last entries
  and the hint line with it. It now stops at the window edge and scrolls its
  list, following the selection as you cycle. It looks the same whenever it
  already fits.
- Close the Ctrl+Tab terminal switcher when you switch away from Lumora.
  Windows takes Alt+Tab before Lumora sees the key release that normally closes
  the switcher, so the popup could stay on screen after you came back. The
  pending switch is abandoned rather than applied.
- Stop drawing a focus ring around the terminal switcher list. The list takes
  focus only to receive keys, so the ring marked the whole popup as focused
  while saying nothing the highlighted row did not already say.

## [0.5.2] - 2026-09-03

### Fixed

- Show the current name for Claude Code sessions that were renamed inside the
  provider. Claude Code records a rename both as a transcript entry and as an
  authoritative sidecar file, and it writes its automatic title immediately
  after the rename, so Lumora kept displaying the automatic title instead of the
  name you chose.
- Keep Claude Code sessions visible after the agent moves between folders. A
  session that started in one workspace and then worked inside a git worktree
  or subfolder was discarded during discovery, so its name, activity time and
  token usage silently stopped updating. Such a session now stays listed under
  the workspace it started in, which is also the workspace Claude Code resumes
  it from.

## [0.5.1] - 2026-09-03

### Fixed

- Restore cross-agent handoff for large file-backed sessions by copying the
  provider-owned transcript first and normalizing it incrementally instead of
  loading the complete source into memory.
- Preserve useful context from oversized histories by retaining bounded opening
  and recent messages, recent tool activity, and explicit partial-coverage
  warnings while leaving the original provider session unchanged.

### Performance

- Bound cross-agent handoff memory use, individual JSONL records, retained
  messages, tool activity, and Claude tool-result tracking so large or malformed
  histories cannot cause unbounded main-process work.

## [0.5.0] - 2026-09-01

### Added

- Add a local Unified UI for verified Codex app-server, Claude Agent SDK, and
  Gemini ACP integrations. The conversation view supports streamed Markdown,
  provider commands and models, cancellation, approvals, process and tool
  activity, file diffs, session usage details, and provider account limits when
  the integration exposes them.
- Extend the local Unified UI capability pipeline to OpenCode, Cursor CLI,
  GitHub Copilot CLI, Qwen Code, Kimi Code, and goose through their native ACP
  server modes. Each route uses its provider-owned executable, authentication,
  session identity, command list, model configuration, tool activity,
  permissions, cancellation, and history capabilities when advertised.
- Add bounded, progressively loaded conversation history. Lumora initially
  renders a small recent window and loads earlier turns as the user scrolls,
  reducing resume-time renderer work for long sessions.
- Resume sessions directly from their normal primary action. Lumora activates
  an already-running session, uses a verified local Unified UI when available,
  and otherwise starts the native PTY path. For providers with an enabled and
  verified Unified UI, right-click can explicitly open that UI or use the
  native terminal for only that launch without changing the saved provider
  preference. The advanced resume dialog remains available, while Remote
  Lumora continues to use direct PTY resume.
- Add an explicitly confirmed **Automatically trust workspaces** security
  preference for users who choose to bypass per-workspace launch confirmation.
- Add an Appearance preference for the Unified UI user-message color while
  preserving the active theme color as the default.

### Changed

- Navigate the open-terminal switcher with Up and Down while holding its
  configured modifier, including continuous key-repeat and wrapped selection.
- Improve direct session launch responsiveness by beginning the normal resume
  flow immediately and keeping preparation and loading inside the terminal
  workspace. Navigation and other Lumora pages remain usable while a provider
  connects, and bounded history loading avoids rendering an entire long session
  before its recent conversation becomes useful.
- Route Unified UI availability through provider capability probes and
  per-provider settings. Disabled, unavailable, incompatible, timed-out, or
  failed integrations fall back to the existing native terminal automatically.
- Gate every ACP route on a bounded protocol handshake and preserve automatic
  native PTY fallback when the installed provider version is unavailable,
  incompatible, times out, or cannot start a structured session. Cursor CLI
  and goose expose new Unified UI sessions while remaining launch-only catalog
  providers.
- Replace expanded inline Unified UI controls with one target-scoped master
  switch and a Lumora detailed-settings dialog. Turning the master switch off
  forces native PTY routing without erasing individual provider choices.
  Provider start commands remain configured in the installation cards rather
  than being duplicated in the Unified UI dialog.
- Keep provider settings controls, conversation actions, dialogs, context
  menus, message-color actions, and loading states aligned with Lumora's shared
  UI components and spacing rules.

### Fixed

- Accept filesystem requests inside ACP workspaces reached through canonical
  path aliases, fixing the Windows and macOS verification failure without
  weakening the real-path containment check against symlink escapes.
- Stabilize structured provider lifecycle handling across first responses,
  subsequent turns, commands, cancellation, reconnection, and clean exit.
- Keep the composer focused after sending, follow new output only while the
  user has not scrolled away, preserve earlier history after a turn completes,
  and keep long conversations visible without unbounded initial rendering.
- Prevent a Unified UI session and a PTY session from concurrently owning the
  same provider session; selecting a running session returns to its existing
  runtime instead of creating a duplicate.
- Cancel a direct session launch when its loading surface is closed, including
  structured-provider startup and late PTY fallback races, so a hidden launch
  cannot leave an agent process running in the background.
- Accept an explicitly selected native PTY result across the validated IPC
  boundary, preventing an already-running terminal from being reported as a
  failed direct launch before its terminal page appears.
- Keep Unified UI detailed settings usable while capability checks run: saved
  provider choices render independently, stale checks cannot overwrite newer
  results, and Close or Escape never becomes trapped behind a slow probe.

### Security

- Keep structured provider processes and session data in the Electron main
  process behind schema-validated IPC, bounded transports, expiring launch
  tokens, provider capability checks, workspace trust, and one-writer session
  ownership. The sandboxed renderer receives normalized events rather than
  direct filesystem or process access.
- Keep additional ACP providers behind the same main-process boundary, strict
  schemas, workspace-confined file access, bounded protocol frames, provider
  permission prompts, and one-writer session ownership.

## [0.4.2] - 2026-08-26

### Added

- Add separate collapsible **Running sessions** and **Recent sessions** lists
  to the expanded sidebar in local and Remote Lumora. Running sessions open
  their existing terminal, while recent sessions use the normal resume flow.

### Changed

- Keep running sessions prioritized within up to 70% of the sidebar and reserve
  at least 30% for recent sessions. Both lists scroll independently with
  low-distraction scrollbars, refresh when a runtime exits, and preserve their
  expanded state separately for local Lumora and each remote computer.
- Hide the terminal tab strip while the sidebar is expanded and restore it when
  the sidebar is collapsed, without unmounting or re-rendering terminal views.

## [0.4.1] - 2026-08-26

### Added

- Add independent interface and terminal font choices in **Settings >
  Appearance**. Lumora uses installed local fonts, preserves safe
  cross-platform fallbacks, and updates open local and remote terminal views
  without restarting or reattaching their sessions.
- Add data-only font presets under the Mods `fonts` directory, with bounded
  validation, isolated rejection, reload controls, and a native folder action.
- Add secure data-only Theme Mods under the Mods `themes` directory, with a
  fixed semantic palette, preview and apply controls, local and Remote Lumora
  appearance parity, bounded validation, and safe built-in-theme fallback.

### Changed

- Upgrade global settings storage to preserve the new font preferences while
  migrating older appearance settings without changing their existing theme
  or background choices.
- Require new user-visible features to update and validate all five bundled
  language packs in the same change.

### Fixed

- Stabilize Windows release verification for Remote Lumora automatic
  connection startup by synchronizing the renderer test with its asynchronous
  connection effect.

### Security

- Keep font Mods declarative: presets contain font-family names only. Lumora
  rejects symbolic links, mismatched filenames, oversized files, malformed
  schemas, and executable content; importing font files remains deferred. Mods
  data and native folder operations remain restricted to the local window.
- Reject theme links, oversized or malformed files, unsafe identifiers,
  filename mismatches, incomplete palettes, and insufficient text contrast.
  Theme Mods cannot load code or target arbitrary component selectors.

## [0.4.0] - 2026-08-25

### Added

- Add global multilingual UI support with system-language detection and
  explicit English, Simplified Chinese, Traditional Chinese, Japanese, and
  Korean selections across local Lumora, Remote Lumora, native menus,
  notifications, dialogs, and locale-aware dates, times, numbers, and plurals.
- Add secure data-only Mods support with a configurable local directory and a
  dedicated settings category for opening, reloading, and maintaining custom
  language packs.
- Add user language packs with partial overrides, immutable English fallback,
  atomic reload, compatibility warnings, and bounded JSON validation. Existing
  per-user language packs remain supported after upgrading.

### Changed

- Follow a supported operating-system language automatically on first use and
  fall back to English otherwise. The language selector now lists explicit
  languages using their native names.
- Package all built-in locale catalogs on Windows, macOS, and Linux, and add
  verification gates for catalog completeness, ICU placeholders, renderer
  strings, and packaged locale resources.

### Security

- Keep Mods data-only: Lumora does not load executable code from the Mods
  directory, rejects symbolic links and unsafe paths, and enforces limits for
  files, packs, messages, and nesting before activating a catalog.

## [0.3.8] - 2026-08-24

### Added

- Show verified agent updates in the Provider discovery card on local and
  Remote Lumora Home pages. Selecting the notice opens **Settings > Providers**
  for the existing update workflow, while disabled automatic checks remain
  silent and perform no background release request.

### Fixed

- Scope `Ctrl+Tab` terminal switching to the visible terminal page in local and
  Remote Lumora, so the terminal switcher no longer opens over Home,
  Workspaces, All sessions, Terminal profiles, or Settings.

## [0.3.7] - 2026-08-21

### Fixed

- Prevent browser-style `Tab` and `Shift+Tab` focus traversal across local and
  Remote Lumora windows, while preserving editable-control focus, terminal-native
  Tab input, modified Tab shortcuts, and shortcut recording.
- Keep long session names from stretching or wrapping terminal tabs. Tab titles
  now use a stable maximum width, display an ellipsis when clipped, and reveal
  the complete name through Lumora's overflow tooltip.

## [0.3.6] - 2026-08-21

### Added

- Add an About category to local and Remote Lumora settings with the installed
  Lumora version, developer, local platform, and connected remote-helper
  details.
- Passively check the latest stable Lumora GitHub release and show a safe
  **View update** link only when a newer version exists. Automatic update
  installation remains deferred until Lumora releases are signed.

## [0.3.5] - 2026-08-19

### Added

- Warn before a full Lumora exit stops active local or remote agents, with an
  independent General setting and an in-dialog **Don't show this warning
  again** choice.
- Warn before disconnecting and closing a Remote Lumora window that has active
  terminal sessions, with its own General setting and suppression choice.

### Fixed

- Limit warning-suppression interaction to the checkbox itself instead of
  making the entire text row clickable, while preserving its accessible label.

## [0.3.4] - 2026-08-16

### Fixed

- Correct Diagnostics resource reporting by separating active local agents from
  Lumora's Electron processes, identifying memory as a cumulative working set,
  and refreshing the first CPU sample when the page opens.
- Keep missing or incompatible remote-helper installation available after an
  automatic SSH connection, without requiring a manual disconnect and
  reconnect.

## [0.3.3] - 2026-08-13

### Added

- Mark provider-owned sessions that are already active in Lumora as Running
  across Home, workspace details, All Sessions, and the tray/menu-bar menu.
  Selecting one now restores and focuses its existing local or remote terminal
  instead of opening another resume workflow.
- Add privacy-safe local diagnostics with bounded process metrics, structured
  lifecycle events, abnormal-shutdown detection, manual refresh, and explicit
  local JSON export from **Settings > Diagnostics**. Diagnostic storage and
  exports exclude prompts, terminal output, session content, credentials,
  environment values, raw exception text, stack traces, identities, and paths.
- Allow users to choose the bounded automatic diagnostic journal folder and
  remember the last successful diagnostic export directory. Custom journal
  changes apply on restart and safely fall back to Lumora's default folder when
  unavailable.
- Add Lumora-styled page and per-terminal recovery boundaries so a renderer
  component failure keeps navigation, unrelated terminals, and managed PTYs
  available for retry.

### Changed

- End startup presentation as soon as persisted application state is ready,
  while provider, environment, and catalog discovery continue in the
  background with the last valid cards and counts kept visible.

### Fixed

- Prevent duplicate provider processes from resuming the same native session,
  including rapid-click and stale-renderer races, while allowing normal resume
  again after the original managed runtime exits.
- Drain terminal launches that are still spawning when shutdown begins,
  coalesce repeated shutdown requests, and reject new launches once teardown
  owns the runtime.
- Wait for in-flight SSH connection attempts before closing remote resources,
  and make concurrent remote shutdown callers share the same completion.

### Performance

- Bound provider and session discovery concurrency, coalesce duplicate
  environment/provider/catalog scans, retain at most one required fresh
  follow-up, and reject stale renderer completions.
- Record bounded scan durations, cache hits, queue counts, and catalog result
  counts in local privacy-safe diagnostics.
- Add a deterministic startup scan-coordination benchmark alongside the
  catalog, terminal-output, and transfer benchmarks.

## [0.3.2] - 2026-08-13

### Added

- Add Kimi Code as a complete local and remote session provider on Windows,
  macOS, and Linux: detection, provider enablement, custom launch commands,
  new sessions, metadata-only catalog discovery, exact `--session` resume,
  rename refresh, effective lifetime-token totals, and source-only cross-agent
  handoff.
- Add explicitly confirmed npm installation for Kimi Code when Node.js 22.19
  or newer is available. Existing Kimi installations use the official updater
  or installation guide instead of an unverified npm overwrite.
- Add Start Menu and desktop shortcut choices to the assisted Windows
  installer. Start Menu is selected by default, desktop is cleared by default,
  silent installations use those defaults, and upgrades preserve the existing
  shortcut state.
- Add Experimental cross-device export and import for Kimi Code sessions.
  Lumora copies the complete selected provider-owned session directory,
  preserves its native identity, maps it to the chosen destination workspace,
  and updates Kimi's append-only session index without transferring account
  credentials or global provider configuration.

### Fixed

- Keep npm-based provider installation, version checks, and terminal launch on
  one compatible Node.js runtime when multiple Node installations are present.
  This prevents a newly installed provider such as Kimi Code from launching
  under an older incompatible Node.js executable.

### Security

- Bound and validate Kimi's session index, state, agent wire data, paths,
  symlinks, record counts, line sizes, token arithmetic, and handoff snapshots.
  Prompts and raw session content remain outside Lumora's searchable catalog.
- Validate every Kimi transfer file path, type, size, digest, native identity,
  workspace bucket, and required session artifact before writing provider data.
  Duplicate imports are skipped, and failed imports remove only the newly
  staged native session and append a Kimi deletion record.

## [0.3.1] - 2026-08-12

### Added

- Paste clipboard images into any live local or remote managed terminal. Lumora
  stages a private, bounded PNG on the terminal's own machine and inserts only
  a readable file reference without submitting the prompt automatically.
- Add target-scoped workspace visibility controls for local and remote
  catalogs. A workspace can be hidden by itself or together with its sessions,
  and the searchable Hidden workspaces dialog can restore one, several, or all
  selections without deleting provider data.

### Changed

- Add General settings to hide unavailable workspaces and currently unusable
  sessions. Catalog filtering is performed in memory after one complete scan,
  preserving responsive search and provider filters for larger catalogs.
- Open remembered automatic SSH profiles through a dedicated connecting state
  instead of briefly exposing authentication controls. If the attempt fails,
  Remote Lumora restores the existing login page with its connection error.
- Make every preference displayed under **General** global across the local
  window and all remote Lumora windows. Changes propagate to open windows
  immediately, while enabled providers, launch commands, credentials, and
  other machine-specific configuration remain isolated per execution target.
- Move **Remote computers** into the local window's primary navigation and
  place **Settings** below the separator in both local and remote Lumora.
- Change the default navigation shortcuts so `Ctrl+5` opens **Remote
  computers** and `Ctrl+,` opens **Settings**. Both remain customizable, and
  existing shortcut settings migrate without losing user-defined bindings.
- Replace the obsolete local-footer `Local only` label with a live active-agent
  count using correct singular and plural labels.

### Performance

- Reduce local verification load with adaptive one-to-three-worker Vitest
  concurrency and avoid a redundant second TypeScript pass while retaining
  every test, helper, typecheck, and production-build gate.

## [0.3.0] - 2026-08-11

### Added

- Add isolated remote-computer windows with SSH profile management, explicit
  host-fingerprint trust, remote platform detection, and ephemeral credentials.
- Add a bounded cross-platform Lumora helper protocol and verified helper
  bundle for Windows, macOS, and Linux on x64 and arm64.
- Add an explicit Lumora confirmation workflow that installs or safely replaces
  the per-user remote helper, verifies its digest, and negotiates compatibility
  before marking the remote target ready.
- Add isolated remote **Environment** and **Providers** settings that discover
  remote Node.js, npm, and target-enabled agent CLIs with paths, versions,
  manual refresh, and per-target provider preferences.
- Add a target-scoped remote Lumora shell with Home, Workspaces, All sessions,
  and Settings; a normalized metadata-only catalog; bounded pagination;
  explicit per-provider coverage; and metadata discovery for Codex, Claude
  Code, Gemini CLI, OpenCode, GitHub Copilot CLI, and Qwen Code.
- Add SSH PTY-backed remote terminals with new-session and exact same-provider
  resume for all six session-managed providers on Windows, macOS, and Linux
  targets.
- Add target-scoped provider start-command customization under remote
  **Settings > Launch**, isolated from local Lumora launch settings.
- Reuse the complete Provider Settings cards in remote Lumora, including
  target-specific start commands, public version checks, official guide links,
  and explicitly confirmed install/update actions for allowlisted npm providers.
- Add opt-in per-profile remembering for SSH passwords and private-key
  passphrases, protected by operating-system secure storage, plus opt-in
  automatic connection for password, private-key, and SSH-agent profiles.
- Add a global remote-window close preference. Disconnect-on-close asks for
  confirmation when the target still has active terminals, with explicit
  **Keep running** and **Disconnect and close** choices.

### Changed

- Group General settings by function so related preferences share one section,
  including the cross-agent handoff switch and temporary-copy retention.
- Make isolated remote windows use Lumora's global theme, managed background,
  opacity hierarchy, mosaic, popup, scrollbar, and shared control styles.
- Reuse Lumora's main shell and catalog views after a remote target reaches
  ready, while keeping the pre-connection and helper setup flow isolated. The
  shared new/resume dialogs, terminal tabs, viewport, details, clipboard,
  shortcut capture, and stop behavior are reused in the remote shell.
- Restore remote Lumora windows from their own shared window size and make them
  honor the global **Start with a maximized window** preference just like the
  local window.
- Keep ready SSH/helper connections alive in the main Lumora process by
  default when an isolated remote window closes. Reopening restores cached
  discovery, catalog, and terminal state without an unnecessary rescan.
- Update remote-computer cards and the sidebar indicator from live connection
  lifecycle events so online state remains accurate across windows.

### Fixed

- Release the remote connection action after SSH/helper activation even when
  the `ready` lifecycle update rerenders an automatic connection, and keep slow
  credential-status refreshes from leaving Disconnect stuck on **Disconnecting**.
- Publish and persist the remote computer's offline state even when graceful
  terminal shutdown reports an error after its SSH resources have closed.
- Standardize dropdowns across local and remote catalogs, session workflows,
  settings, terminal profiles, and transfers on Lumora's overlay menu, and use
  a Lumora confirmation dialog when opening terminal links.
- Let remotely discovered npm and provider wrappers resolve companion runtimes
  from their installation directory when reading versions.
- Serialize automatic remote discovery and session scans over the helper
  channel, and report recoverable provider scan failures inside the catalog
  instead of raising a generic remote-target IPC error.
- Compare provider session timestamps chronologically during catalog
  synchronization so resumed sessions remain valid when providers change ISO
  timestamp precision.

- Ensure `npm run dev` builds a missing or stale verified remote-helper bundle
  before Electron starts, while reusing an already current bundle in subsequent
  development launches and isolated worktrees.
- Allow remote connection profiles to be edited and deleted with validated,
  in-app confirmation workflows and user-safe failure messages.
- Close a target's isolated window and dispose its active SSH/helper resources
  before changing or deleting that profile, preventing stale target state.
- Report remote connection failures as bounded, actionable stages for SSH,
  platform probing, helper verification, and file transfer without exposing
  credentials or raw remote diagnostics.
- Detect unexpected SSH transport closure, release target resources, and keep
  the current remote page and cached catalog visible with a reconnect banner.
- Reconcile newly started remote provider sessions back to their native catalog
  identity and safely handle repeated close, late PTY events, missing exit
  codes, disconnect, profile mutation, and application shutdown.

- Stop superseded launch-preflight requests from surfacing as terminal IPC
  failures while keeping their launch tokens unusable.
- Remove the unsupported Windows node-pty encoding option and its development
  console warning.

### Security

- Scope remote-helper inspection and installation to the immutable target of
  the authorized remote window; the renderer cannot supply or change that
  target identifier.
- Keep remote helper installation non-elevated, versioned, digest-verified, and
  atomically activated without exposing remote diagnostics or credentials.
- Keep remote discovery read-only and allowlisted with bounded probes. Remote
  environment variables, credentials, tokens, and provider session contents
  are not returned to the renderer.
- Keep remote provider lifecycle execution target-bound and non-elevated, with
  generated package allowlists, structured arguments, bounded time/output, and
  no raw npm or shell diagnostics exposed to the renderer.
- Keep remote session discovery metadata-only, strip helper-private source keys
  at the main-process boundary, and bound command output, page size, page count,
  record count, file enumeration, file reads, provider protocol traffic, and
  control-frame size.
- Resolve remote launch authority from the immutable sender-window target,
  validate absolute provider/workspace paths and shell arguments in the main
  process, and deliver PTY events only to that target's isolated window.
- Expose only a read-only appearance projection to isolated remote windows;
  appearance mutations remain restricted to the local Lumora window.
- Keep remembered remote credentials outside ordinary profile data as
  OS-protected encrypted blobs, reject insecure Linux fallback storage, remove
  credentials on authentication changes or profile deletion, and limit
  automatic connection to one host-verified attempt with manual recovery.

## [0.2.3] - 2026-08-03

### Changed

- Replace browser-native hover titles with compact, theme-aware Lumora tooltips
  that support delayed hover, deliberate keyboard focus, shortcut labels,
  overflow-only hints, and viewport-safe placement.
- Make navigation, catalog cards, and page toolbar actions follow app-style
  focus behavior while preserving normal input, dialog, settings, transfer,
  shortcut-recorder, and terminal focus.

## [0.2.2] - 2026-07-31

### Changed

- Change the default open/focus-terminal shortcut from `Ctrl+T` to
  `Ctrl+Shift+T`. Existing installations that still use the former default are
  migrated automatically; user-customized shortcuts are preserved.
- Give a focused provider terminal priority over non-reserved Lumora shortcuts
  so native TUI controls are not intercepted. `Ctrl+Tab` and `Ctrl+Shift+L`
  remain Lumora controls.
- Add an isolated bracketed-paste compatibility attempt for Codex
  `Shift+Enter`, while preserving existing modified-Enter compatibility
  sequences for other provider and modifier combinations.

### Fixed

- Stop managed sessions with a bounded graceful shutdown sequence before native
  PTY escalation, wait for the process's real exit event, and report an
  unobservable forced exit honestly as `runtime_lost`.
- Coalesce concurrent Stop and application-quit requests so Lumora performs one
  native shutdown sequence per managed terminal.

### Performance

- Batch adjacent PTY output into bounded IPC events and retain the attachment
  snapshot in bounded chunks, reducing main-process work during output-heavy
  native session resume.
- Rebuild the native tray menu only for runtime state changes, not for every
  terminal output fragment.

### Known issues

- Codex `Shift+Enter` does not reliably insert a multiline newline inside
  Lumora's embedded terminal. The compatibility sequence is retained for
  continued investigation, but the issue is not considered fixed.

## [0.2.1] - 2026-07-30

### Added

- Add a native Lumora tray/menu-bar icon with platform-appropriate visible
  artwork, live running-agent count, recent session shortcuts, window show/hide
  control, and an explicit orderly exit.
- Add a General settings switch that chooses whether closing the window exits
  Lumora or hides it while keeping managed agents running.
- Add a dedicated Appearance settings category with live Lumora mixed, Light,
  and Dark themes. New and migrated installations use Lumora's original mixed
  theme by default, while managed terminals remain dark unless their separate
  light-terminal option is enabled.
- Add an optional full-window custom background with managed local image
  storage and controls for opacity, brightness, blur, fit, position, surface
  transparency, terminal transparency, and an optional `0–24 px` Surface
  mosaic. Surface and terminal transparency support the full `0–100%` range;
  terminal canvases, terminal page chrome, system status, controls, cards, and
  in-app dialogs follow those controls. Semantic opacity levels distinguish
  recessed, normal, raised, and popup surfaces, while popups retain a readable
  minimum opacity. Mosaic defaults to zero so custom backgrounds can remain
  clear.

### Changed

- Remove the static topbar provider-discovery badge, which did not report live
  scan state or provide an action. Dynamic discovery health remains available
  on the Home page and in provider settings.
- Reopening Lumora while another instance is hidden now restores and focuses
  the existing window instead of starting a second application process.

### Fixed

- Open confirmed HTTP(S) hyperlinks from managed terminals in the user's
  default browser while keeping renderer-created windows and unsafe URL
  protocols blocked.
- Preserve POSIX nested workspace paths when importing Claude Code sessions on
  macOS and Linux, and keep transfer dialog path verification platform-native.
- Make xterm's parent viewport follow Terminal opacity so managed backgrounds
  remain visible through the complete PTY area while provider ANSI colors stay
  intact.

### Security

- Validate, resize, and normalize custom backgrounds into an app-owned PNG.
  The renderer receives only a fixed `app://appearance/background` URL, never
  the selected source path or unrestricted filesystem access.

## [0.2.0] - 2026-07-30

### Added

- Add guarded cross-device session archives with encrypted-by-default export,
  mixed-provider import, cross-platform workspace mapping, duplicate protection,
  progress, cancellation, and non-sensitive transfer history.
- Add a dedicated export-selection workflow under **Settings > Transfer**.
  Running, stale, unavailable, and unverified provider sessions remain disabled,
  while daily session and workspace pages stay focused on normal navigation.
- Add provider-native transfer adapters for OpenCode, Codex, Claude Code,
  Gemini CLI, GitHub Copilot CLI, and Qwen Code. Transfer routes are marked
  experimental in development builds so they can be tested, while normal
  packages remain disabled until their exact provider version and
  operating-system pair pass packaged verification.

### Security

- Keep provider files, archive paths, staging paths, and passwords in the main
  process behind validated, expiring operation tokens.
- Validate archive structure, paths, hashes, sizes, provider payload identity,
  destination workspace directories, and post-import native discovery before a
  transfer is accepted.

### Fixed

- Discover OpenCode sessions globally through OpenCode's official metadata-only
  database command, with a structured session-list fallback for older versions.
- Discover GitHub Copilot CLI session directories that contain legacy native
  workspace metadata but do not yet contain an events file.
- Roll back a newly forked Codex thread if native post-import setup fails or is
  cancelled, so a partial import is not left behind.
- Export Claude Code sessions whose Windows workspace casing was normalized by
  the catalog or whose transcript contains nested working directories, and map
  those nested paths when importing into a different workspace.

## [0.1.3] - 2026-07-29

### Changed

- Cap local Vitest runs at six workers to keep the desktop responsive while
  preserving the complete test suite. CI continues to use runner-appropriate
  Vitest parallelism.

## [0.1.2] - 2026-07-29

### Fixed

- Paste clipboard text into a live terminal with right-click.
- Close Codex terminals predictably after confirmed double-`Ctrl+C`, or when
  an explicit `/exit` or `/quit` command leaves the terminal process attached.

## [0.1.1] - 2026-07-28

### Added

- Allow open terminal tabs to be reordered by dragging or with
  `Alt+Shift+Left` and `Alt+Shift+Right` while a tab is focused. Visual tab
  order remains independent from the `Ctrl+Tab` most-recently-used switcher.

## [0.1.0] - 2026-07-28

### Added

- Initial Lumora MVP release for Windows, macOS, and Linux.
