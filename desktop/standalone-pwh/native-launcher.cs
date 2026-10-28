using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

// This is Pwh's own Windows launcher. The document UI and Codex integration
// remain in the existing local application; no other application's code is used.
internal static class PwhDesktopLauncher
{
    private const string ApplicationId = "STOOM.PwhDesktop";
    private const uint WmSetIcon = 0x0080;
    private const uint WmGetIcon = 0x007F;
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern int SetCurrentProcessExplicitAppUserModelID(string applicationId);
    [DllImport("shell32.dll")] private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid identifier, out IPropertyStore store);

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        public Guid Format;
        public uint Id;
        public PropertyKey(uint id) { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); Id = id; }
    }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Value;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    private static void SetString(IPropertyStore store, uint id, string text)
    {
        PropertyKey key = new PropertyKey(id);
        PropVariant value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(text) };
        try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); }
        finally { Marshal.FreeCoTaskMem(value.Value); }
    }
    private static void ClearWindowProperties(IntPtr window)
    {
        Guid id = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        if (SHGetPropertyStoreForWindow(window, ref id, out store) < 0) return;
        try
        {
            foreach (uint property in new uint[] { 5, 2, 3 })
            {
                PropertyKey key = new PropertyKey(property);
                PropVariant empty = new PropVariant();
                store.SetValue(ref key, ref empty);
            }
        }
        finally { Marshal.ReleaseComObject(store); }
    }
    private static void SetWindowProperties(IntPtr window, string executable)
    {
        Guid id = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref id, out store));
        try
        {
            SetString(store, 2, Quote(executable));
            SetString(store, 3, Path.Combine(Path.GetDirectoryName(executable), "standalone-pwh", "stoom.ico") + ",0");
            SetString(store, 5, ApplicationId);
            Marshal.ThrowExceptionForHR(store.Commit());
        }
        finally { Marshal.ReleaseComObject(store); }
    }
    private static bool SetIcon(IntPtr window, IntPtr kind, IntPtr icon)
    {
        IntPtr result;
        return SendMessageTimeout(window, WmSetIcon, kind, icon, 0x0003, 1000, out result) != IntPtr.Zero;
    }
    private static IntPtr ReadIcon(IntPtr window, IntPtr kind)
    {
        IntPtr result;
        return SendMessageTimeout(window, WmGetIcon, kind, IntPtr.Zero, 0x0003, 1000, out result) == IntPtr.Zero ? IntPtr.Zero : result;
    }
    private static int BrandWindow(string token)
    {
        if (!Regex.IsMatch(token, "\\A[0-9a-f]{32}\\z")) return 2;
        string marker = "Pwh Desktop [" + token + "]";
        string executable = Application.ExecutablePath;
        IntPtr[] large = new IntPtr[1], small = new IntPtr[1];
        if (ExtractIconEx(executable, 0, large, small, 1) == 0 || large[0] == IntPtr.Zero || small[0] == IntPtr.Zero) return 3;
        try
        {
            IntPtr target = IntPtr.Zero;
            DateTime deadline = DateTime.UtcNow.AddSeconds(45);
            while (target == IntPtr.Zero && DateTime.UtcNow < deadline)
            {
                EnumWindows(delegate(IntPtr window, IntPtr ignored) {
                    if (!IsWindowVisible(window)) return true;
                    StringBuilder title = new StringBuilder(512);
                    GetWindowText(window, title, title.Capacity);
                    if (title.ToString().StartsWith(marker, StringComparison.Ordinal)) { target = window; return false; }
                    return true;
                }, IntPtr.Zero);
                if (target == IntPtr.Zero) Thread.Sleep(150);
            }
            if (target == IntPtr.Zero) return 4;
            uint process;
            GetWindowThreadProcessId(target, out process);
            if (!SetIcon(target, IntPtr.Zero, small[0]) || !SetIcon(target, new IntPtr(1), large[0])) return 5;
            SetWindowProperties(target, executable);
            Console.WriteLine("PWH_WINDOW_BRANDED " + target.ToInt64());
            Console.Out.Flush();
            ManualResetEvent brandingWanted = new ManualResetEvent(true);
            Thread closeReader = new Thread(delegate() { try { string command; while ((command = Console.In.ReadLine()) != null) { if(command == "closing") brandingWanted.Reset(); else if(command == "ready") brandingWanted.Set(); } } catch { } });
            closeReader.IsBackground = true;
            closeReader.Start();
            bool propertiesCleared = false;
            // The icon handles must stay alive while this window uses them.
            while (IsWindow(target))
            {
                uint currentProcess;
                GetWindowThreadProcessId(target, out currentProcess);
                if (currentProcess != process) break;
                if (!propertiesCleared && !brandingWanted.WaitOne(0)) { ClearWindowProperties(target); propertiesCleared = true; }
                else if (propertiesCleared && brandingWanted.WaitOne(0)) { SetWindowProperties(target, executable); propertiesCleared = false; }
                if (ReadIcon(target, IntPtr.Zero) != small[0]) SetIcon(target, IntPtr.Zero, small[0]);
                if (ReadIcon(target, new IntPtr(1)) != large[0]) SetIcon(target, new IntPtr(1), large[0]);
                Thread.Sleep(200);
            }
            return 0;
        }
        finally { DestroyIcon(large[0]); DestroyIcon(small[0]); }
    }
    // Windows CreateProcess argument quoting, including trailing backslashes.
    private static string Quote(string value)
    {
        StringBuilder output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { output.Append('\\', slashes * 2 + 1); output.Append(c); slashes = 0; continue; }
            output.Append('\\', slashes); slashes = 0; output.Append(c);
        }
        output.Append('\\', slashes * 2); output.Append('"');
        return output.ToString();
    }
    [STAThread]
    private static int Main(string[] arguments)
    {
        try
        {
            SetCurrentProcessExplicitAppUserModelID(ApplicationId);
            if (arguments.Length == 2 && arguments[0] == "--brand-window") return BrandWindow(arguments[1]);
            string root = Path.GetDirectoryName(Application.ExecutablePath);
            string node = Path.Combine(root, "node", "node.exe");
            string script = Path.Combine(root, "standalone-pwh", "launch.mjs");
            if (!File.Exists(node) || !File.Exists(script)) throw new FileNotFoundException();
            StringBuilder command = new StringBuilder(Quote(script));
            foreach (string argument in arguments) command.Append(" ").Append(Quote(argument));
            ProcessStartInfo start = new ProcessStartInfo(node, command.ToString()) {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true
            };
            start.EnvironmentVariables["PWH_NATIVE_LAUNCHER"] = Application.ExecutablePath;
            using (Process process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
        }
        catch
        {
            if (arguments.Length == 2 && arguments[0] == "--brand-window") return 6;
            MessageBox.Show("Pwh Desktop을 시작하지 못했습니다. 설치 상태와 문서 형식을 확인해 주세요.", "Pwh Desktop", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
