using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class NativeBrandingTest
{
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("shell32.dll")] private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid identifier, out Store store);
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)] private static extern uint ExtractIconEx(string file,int index,IntPtr[] large,IntPtr[] small,uint count);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    private static bool SamePixels(IntPtr left,IntPtr right)
    {
        using(Icon a=Icon.FromHandle(left)) using(Icon b=Icon.FromHandle(right))
        using(Bitmap x=a.ToBitmap()) using(Bitmap y=b.ToBitmap())
        {
            if(x.Size!=y.Size)return false;
            for(int py=0;py<x.Height;py++)for(int px=0;px<x.Width;px++)if(x.GetPixel(px,py)!=y.GetPixel(px,py))return false;
            return true;
        }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Key { public Guid Format; public uint Id; }
    [StructLayout(LayoutKind.Explicit,Size=24)] private struct Value { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }
    [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface Store { [PreserveSig] int Count(out uint count); [PreserveSig] int At(uint index,out Key key); [PreserveSig] int Get(ref Key key,out Value value); [PreserveSig] int Set(ref Key key,ref Value value); [PreserveSig] int Commit(); }
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref Value value);
    private static string ApplicationId(IntPtr window)
    {
        Guid id=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");Store store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window,ref id,out store));
        try { Key key=new Key { Format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),Id=5 };Value value;Marshal.ThrowExceptionForHR(store.Get(ref key,out value));try { return value.Type==31?Marshal.PtrToStringUni(value.Pointer):null; } finally { PropVariantClear(ref value); } }
        finally { Marshal.ReleaseComObject(store); }
    }
    [STAThread] private static int Main(string[] args)
    {
        using(Form target=new Form()) using(Form unrelated=new Form())
        {
            string token=Guid.NewGuid().ToString("N");
            target.Text="Pwh Desktop ["+token+"]";unrelated.Text="Pwh Desktop ["+Guid.NewGuid().ToString("N")+"]";
            foreach(Form form in new[] {target,unrelated}) { form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-30000,-30000);form.ShowInTaskbar=false;form.Show(); }
            IntPtr otherBefore=SendMessage(unrelated.Handle,0x7f,new IntPtr(1),IntPtr.Zero);
            ProcessStartInfo start=new ProcessStartInfo(args[0],"--brand-window "+token) { UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardInput=true,RedirectStandardError=true };
            using(Process helper=Process.Start(start))
            {
                string ready=null;DateTime deadline=DateTime.UtcNow.AddSeconds(15);
                var read=helper.StandardOutput.ReadLineAsync();
                while(!read.IsCompleted&&DateTime.UtcNow<deadline) { Application.DoEvents();Thread.Sleep(20); }
                if(read.IsCompleted)ready=read.Result;
                bool small=SendMessage(target.Handle,0x7f,IntPtr.Zero,IntPtr.Zero)!=IntPtr.Zero;
                bool big=SendMessage(target.Handle,0x7f,new IntPtr(1),IntPtr.Zero)!=IntPtr.Zero;
                bool unchanged=SendMessage(unrelated.Handle,0x7f,new IntPtr(1),IntPtr.Zero)==otherBefore;
                IntPtr[] expectedLarge=new IntPtr[1],expectedSmall=new IntPtr[1];
                if(ExtractIconEx(args[1],0,expectedLarge,expectedSmall,1)==0)throw new Exception("Canonical icon was not loaded.");
                bool pixelsMatch;
                try { pixelsMatch=SamePixels(SendMessage(target.Handle,0x7f,new IntPtr(1),IntPtr.Zero),expectedLarge[0])&&SamePixels(SendMessage(target.Handle,0x7f,IntPtr.Zero,IntPtr.Zero),expectedSmall[0]); }
                finally { DestroyIcon(expectedLarge[0]);DestroyIcon(expectedSmall[0]); }
                string appId=ApplicationId(target.Handle);
                helper.StandardInput.WriteLine("closing");helper.StandardInput.Flush();
                DateTime cleanup=DateTime.UtcNow.AddSeconds(3);
                while(ApplicationId(target.Handle)!=null&&DateTime.UtcNow<cleanup) { Application.DoEvents();Thread.Sleep(20); }
                bool cleared=ApplicationId(target.Handle)==null;
                helper.StandardInput.WriteLine("ready");helper.StandardInput.Flush();
                DateTime restoredDeadline=DateTime.UtcNow.AddSeconds(3);
                while(ApplicationId(target.Handle)!="STOOM.PwhDesktop"&&DateTime.UtcNow<restoredDeadline) { Application.DoEvents();Thread.Sleep(20); }
                bool restored=ApplicationId(target.Handle)=="STOOM.PwhDesktop";
                helper.StandardInput.WriteLine("closing");helper.StandardInput.Flush();
                DateTime finalClearDeadline=DateTime.UtcNow.AddSeconds(3);
                while(ApplicationId(target.Handle)!=null&&DateTime.UtcNow<finalClearDeadline) { Application.DoEvents();Thread.Sleep(20); }
                cleared=cleared&&ApplicationId(target.Handle)==null;
                target.Close();unrelated.Close();Application.DoEvents();
                if(!helper.WaitForExit(5000))throw new Exception("Helper did not release the closed test window.");
                bool passed=ready!=null&&ready.StartsWith("PWH_WINDOW_BRANDED ")&&small&&big&&pixelsMatch&&unchanged&&appId=="STOOM.PwhDesktop"&&cleared&&restored&&helper.ExitCode==0;
                Console.WriteLine("{\"passed\":"+passed.ToString().ToLowerInvariant()+",\"canonicalPixelsMatch\":"+pixelsMatch.ToString().ToLowerInvariant()+",\"smallIcon\":"+small.ToString().ToLowerInvariant()+",\"largeIcon\":"+big.ToString().ToLowerInvariant()+",\"otherWindowUnchanged\":"+unchanged.ToString().ToLowerInvariant()+",\"appId\":\""+appId+"\",\"restoredAfterReload\":"+restored.ToString().ToLowerInvariant()+",\"propertiesClearedBeforeClose\":"+cleared.ToString().ToLowerInvariant()+"}");
                return passed?0:1;
            }
        }
    }
}
