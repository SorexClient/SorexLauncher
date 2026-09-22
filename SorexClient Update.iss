; Inno Setup Script für Sorex Launcher UPDATER
; Dieses Script aktualisiert eine bestehende Installation

#define MyAppName "Sorex Launcher"
#define MyAppVersion "2.0.5" ; Hier die neue Version eintragen
#define MyAppPublisher "Sorex Launcher Team"
#define MyAppURL "https://www.sorexclient.com/"
#define MyAppExeName "Sorex Launcher.exe"

[Setup]
; WICHTIG: Die AppId muss exakt dieselbe sein wie im Haupt-Script!
AppId={{8FB708F0-67E0-484D-B8EC-330F9E7701A6}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Update-Spezifische Einstellungen
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
CloseApplications=force
OutputBaseFilename=SorexLauncher_Update_Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Files]
; Kopiere die neuen Dateien aus dem Release-Ordner
Source: "release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
; Launcher nach dem Update sofort wieder starten
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
