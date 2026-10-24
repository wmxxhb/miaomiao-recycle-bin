Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
Name "喵喵回收站"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\MiaomiaoRecycleBin"
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "喵喵回收站"
VIAddVersionKey /LANG=2052 "FileDescription" "喵喵回收站安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "2026 wmxxhb; character assets belong to their respective owners"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\喵喵回收站.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动喵喵回收站"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${SOURCE_DIR}\resources\app\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onVerifyInstDir
  IfFileExists "$INSTDIR\*.*" 0 empty
  IfFileExists "$INSTDIR\.miaomiao-install.ini" empty
  Abort
  empty:
FunctionEnd

Section "安装"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "${SOURCE_DIR}\*"
  IfErrors failed
  WriteUninstaller "$INSTDIR\卸载.exe"
  WriteINIStr "$INSTDIR\.miaomiao-install.ini" "Install" "Product" "MiaomiaoRecycleBin"
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/NOINTEGRATION" $1
  ${If} ${Errors}
    WriteINIStr "$INSTDIR\.miaomiao-install.ini" "Install" "Integrated" "1"
    CreateDirectory "$SMPROGRAMS\喵喵回收站"
    CreateShortcut "$SMPROGRAMS\喵喵回收站\喵喵回收站.lnk" "$INSTDIR\喵喵回收站.exe"
    CreateShortcut "$SMPROGRAMS\喵喵回收站\卸载.lnk" "$INSTDIR\卸载.exe"
    CreateShortcut "$DESKTOP\喵喵回收站.lnk" "$INSTDIR\喵喵回收站.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "DisplayName" "喵喵回收站"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "UninstallString" '$\"$INSTDIR\卸载.exe$\"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "Publisher" "wmxxhb"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "URLInfoAbout" "https://github.com/wmxxhb/miaomiao-recycle-bin"
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "NoRepair" 1
  ${Else}
    WriteINIStr "$INSTDIR\.miaomiao-install.ini" "Install" "Integrated" "0"
  ${EndIf}
  Goto finished
  failed:
    MessageBox MB_OK|MB_ICONSTOP "安装未完成。请先通过托盘退出旧版喵喵，再重新运行安装程序。" /SD IDOK
    SetErrorLevel 1
  finished:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ReadINIStr $0 "$INSTDIR\.miaomiao-install.ini" "Install" "Integrated"
  ${If} $0 == "1"
    ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin" "InstallLocation"
    ${If} $1 == $INSTDIR
      Delete "$DESKTOP\喵喵回收站.lnk"
      Delete "$SMPROGRAMS\喵喵回收站\喵喵回收站.lnk"
      Delete "$SMPROGRAMS\喵喵回收站\卸载.lnk"
      RMDir "$SMPROGRAMS\喵喵回收站"
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MiaomiaoRecycleBin"
    ${EndIf}
  ${EndIf}
  ; Generated list deletes only files installed by this version. Never recursively delete INSTDIR or user data.
  !include "${UNINSTALL_MANIFEST}"
  Delete "$INSTDIR\.miaomiao-install.ini"
  Delete "$INSTDIR\卸载.exe"
  RMDir "$INSTDIR"
SectionEnd
