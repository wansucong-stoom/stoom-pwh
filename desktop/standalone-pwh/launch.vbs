Option Explicit
Dim shell, fso, root, cmd, args, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = Chr(34) & fso.BuildPath(root, "PwhDesktop.exe") & Chr(34)
For i = 0 To WScript.Arguments.Count - 1
  args = Replace(WScript.Arguments(i), Chr(34), "")
  cmd = cmd & " " & Chr(34) & args & Chr(34)
Next
shell.CurrentDirectory = root
If shell.Run(cmd, 0, True) <> 0 Then
  MsgBox "Pwh Desktop을 시작하지 못했습니다. 설치 상태와 문서 형식을 확인하세요.", 16, "Pwh Desktop"
End If
