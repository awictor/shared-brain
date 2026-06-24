Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c node C:\Users\awictor\shared-brain\watchdog.mjs > C:\Users\awictor\shared-brain\server.log 2>&1", 0, False
