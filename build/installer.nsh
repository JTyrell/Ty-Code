!macro customInstall
  DetailPrint "Registering Ty-Code directory context menus..."
  WriteRegStr HKCR "Directory\shell\TyCode" "" "Open with Ty-Code"
  WriteRegStr HKCR "Directory\shell\TyCode" "Icon" "$INSTDIR\Ty-Code.exe"
  WriteRegStr HKCR "Directory\shell\TyCode\command" "" '"$INSTDIR\Ty-Code.exe" "%1"'

  WriteRegStr HKCR "Directory\Background\shell\TyCode" "" "Open with Ty-Code"
  WriteRegStr HKCR "Directory\Background\shell\TyCode" "Icon" "$INSTDIR\Ty-Code.exe"
  WriteRegStr HKCR "Directory\Background\shell\TyCode\command" "" '"$INSTDIR\Ty-Code.exe" "%V"'
!macroend

!macro customUnInstall
  DetailPrint "Removing Ty-Code directory context menus..."
  DeleteRegKey HKCR "Directory\shell\TyCode"
  DeleteRegKey HKCR "Directory\Background\shell\TyCode"
!macroend
