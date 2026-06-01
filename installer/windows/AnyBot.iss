#define AppVersion GetEnv("APP_VERSION")
#if AppVersion == ""
#define AppVersion "0.1.26"
#endif

#define RepoRoot AddBackslash(SourcePath) + "..\.."
#define SourceDir RepoRoot + "\.packaging\AnyBot-win-x64"
#define OutputDir RepoRoot + "\release-assets"

[Setup]
AppId={{8B86C6F8-F3D0-4C7B-8B2D-7D2A98D5C3A6}
AppName=AnyBot
AppVersion={#AppVersion}
AppPublisher=AnyBot
DefaultDirName={localappdata}\Programs\AnyBot
DefaultGroupName=AnyBot
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=AnyBot-Setup-{#AppVersion}-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\start-anybot.cmd
CloseApplications=no

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AnyBot"; Filename: "{app}\start-anybot.vbs"; WorkingDir: "{app}"
Name: "{group}\打开 AnyBot Web UI"; Filename: "http://localhost:19981"
Name: "{group}\停止 AnyBot"; Filename: "{app}\stop-anybot.cmd"; WorkingDir: "{app}"
Name: "{group}\卸载 AnyBot"; Filename: "{uninstallexe}"
Name: "{userdesktop}\AnyBot"; Filename: "{app}\start-anybot.vbs"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\start-anybot.vbs"; Description: "启动 AnyBot"; Flags: nowait postinstall skipifsilent
