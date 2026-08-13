!ifndef BUILD_UNINSTALLER

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var LumoraStartMenuShortcutCheckbox
Var LumoraDesktopShortcutCheckbox
Var LumoraCreateStartMenuShortcut
Var LumoraCreateDesktopShortcut
Var LumoraShowShortcutOptions

!macro customInit
  StrCpy $LumoraCreateStartMenuShortcut ${BST_CHECKED}
  StrCpy $LumoraCreateDesktopShortcut ${BST_UNCHECKED}
  StrCpy $LumoraShowShortcutOptions "true"
  ${If} ${isUpdated}
    StrCpy $LumoraShowShortcutOptions "false"
  ${EndIf}
  ${If} ${Silent}
    StrCpy $LumoraShowShortcutOptions "false"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom LumoraShortcutOptionsPageCreate LumoraShortcutOptionsPageLeave
!macroend

Function LumoraShortcutOptionsPageCreate
  ${If} $LumoraShowShortcutOptions != "true"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Choose where Lumora shortcuts are created."
  Pop $0

  ${NSD_CreateCheckbox} 0 34u 100% 12u "Create a Start Menu shortcut"
  Pop $LumoraStartMenuShortcutCheckbox
  ${NSD_SetState} $LumoraStartMenuShortcutCheckbox $LumoraCreateStartMenuShortcut

  ${NSD_CreateCheckbox} 0 58u 100% 12u "Create a desktop shortcut"
  Pop $LumoraDesktopShortcutCheckbox
  ${NSD_SetState} $LumoraDesktopShortcutCheckbox $LumoraCreateDesktopShortcut

  nsDialogs::Show
FunctionEnd

Function LumoraShortcutOptionsPageLeave
  ${NSD_GetState} $LumoraStartMenuShortcutCheckbox $LumoraCreateStartMenuShortcut
  ${NSD_GetState} $LumoraDesktopShortcutCheckbox $LumoraCreateDesktopShortcut
FunctionEnd

!macro customInstall
  ${IfNot} ${isUpdated}
    ${If} $LumoraCreateStartMenuShortcut != ${BST_CHECKED}
      Delete "$newStartMenuLink"
      !ifdef MENU_FILENAME
        RMDir "$SMPROGRAMS\${MENU_FILENAME}"
      !endif
      StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${EndIf}

    ${If} $LumoraCreateDesktopShortcut != ${BST_CHECKED}
      Delete "$newDesktopLink"
    ${EndIf}
  ${EndIf}
!macroend

!endif
