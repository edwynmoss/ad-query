Unicode true

####
## AD Query installer.
##
## Built by `wails build -nsis`; wails_tools.nsh is generated at build time
## and supplies INFO_* from wails.json. Artwork comes from
## scripts/installer-art.py (sidebar.bmp, header.bmp, splash.bmp).
##
## Per-user install with no administrator prompt: files go under
## %LOCALAPPDATA%\Programs, shortcuts and the uninstall entry are written
## for the current user only.
####

!define REQUEST_EXECUTION_LEVEL "user"

!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Setup"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

ManifestDPIAware true
SetCompressor /SOLID lzma
BrandingText "${INFO_PRODUCTNAME} ${INFO_PRODUCTVERSION}"

!include "MUI.nsh"

# --- Look ---------------------------------------------------------------
# Dark welcome and finish pages matching the sidebar; a dark header strip on
# the inner pages with the mark at the right.
!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_BGCOLOR "111827"
!define MUI_TEXTCOLOR "F3F4F6"
!define MUI_WELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "header.bmp"
!define MUI_HEADER_TRANSPARENT_TEXT
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "${INFO_PRODUCTNAME} is not installed yet. Leave the setup?"

# --- Welcome ------------------------------------------------------------
!define MUI_WELCOMEPAGE_TITLE "${INFO_PRODUCTNAME}"
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_WELCOMEPAGE_TEXT "Ask your directory plain questions and export exactly the columns you need. Read-only by design: it never changes anything in Active Directory or Microsoft 365.$\r$\n$\r$\nSetup installs for your account only, so no administrator prompt.$\r$\n$\r$\nClick Next to choose where it goes."

# --- Finish -------------------------------------------------------------
!define MUI_FINISHPAGE_TITLE "Ready"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "${INFO_PRODUCTNAME} is installed. On a domain-joined machine it signs you in as yourself with no password.$\r$\n$\r$\nThe Tools menu inside the app lists reports, bulk lookup and updates."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${INFO_PRODUCTNAME} now"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

# --- Splash -------------------------------------------------------------
# A short fade of the mark while setup starts. advsplash ships with NSIS.
!define MUI_CUSTOMFUNCTION_GUIINIT ShowSplash

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe"
InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
InstallDirRegKey HKCU "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}" "InstallDir"
ShowInstDetails nevershow
ShowUninstDetails nevershow

Function ShowSplash
  InitPluginsDir
  File /oname=$PLUGINSDIR\splash.bmp "splash.bmp"
  advsplash::show 700 300 300 -1 "$PLUGINSDIR\splash"
  Pop $0
  Delete "$PLUGINSDIR\splash.bmp"
FunctionEnd

Function CreateDesktopShortcut
  CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
FunctionEnd

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    WriteRegStr HKCU "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}" "InstallDir" "$INSTDIR"
    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller

    # In-app updates run this installer silently; bring the app straight back.
    IfSilent 0 +2
      Exec '"$INSTDIR\${PRODUCT_EXECUTABLE}"'
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    DeleteRegKey HKCU "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
