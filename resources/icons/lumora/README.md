# Lumora Icon Pack

A production-ready icon set for **Lumora**, a local agent workspace and session manager.

## Visual idea

The icon uses a compact **L** monogram. The detached cyan tile suggests a workspace,
session tab, or local agent process without spelling out the full product name.

Primary cyan: `#22D3EE`

## Use these files

### Windows

- `windows/Lumora.ico`  
  Dark application tile for the executable, desktop shortcut, installer, and Start menu.

- `windows/LumoraTransparent.ico`  
  Transparent cyan symbol for a floating taskbar/tray appearance.

- `windows/LumoraTrayWhite.ico`  
  White transparent tray icon for dark system themes.

- `windows/msix-assets/`  
  Common MSIX/Windows packaging PNG names.

### macOS

- `macos/Lumora.icns`  
  Dock, Finder, and application bundle icon.

- `macos/Assets.xcassets/AppIcon.appiconset/`  
  Ready to place inside an Xcode asset catalog.

- `macos/menu-bar/LumoraTemplate.png` and `@2x`  
  Monochrome template images. macOS automatically adapts these to light/dark menu bars.

- `macos/menu-bar/LumoraStatusCyan.png` and `@2x`  
  Cyan status icon when you do not want native template tinting.

### Linux

- `linux/usr/share/icons/hicolor/`  
  Freedesktop-compatible PNG and scalable SVG icon tree.

- `linux/usr/share/icons/hicolor/symbolic/apps/lumora-symbolic.svg`  
  Theme-aware symbolic icon for panels and trays.

- `linux/lumora.png` and `linux/.DirIcon`  
  Convenient AppImage assets.

- `linux/lumora.desktop.example`  
  Example desktop entry using `Icon=lumora`.

## Shared assets

- `source/` contains editable SVG masters.
- `common/transparent/` contains transparent cyan, white, and black PNG sizes.

## Notes

- The taskbar, tray, and menu-bar assets intentionally have **transparent backgrounds**.
- The desktop/Dock application icon keeps a dark rounded tile for stronger recognition.
