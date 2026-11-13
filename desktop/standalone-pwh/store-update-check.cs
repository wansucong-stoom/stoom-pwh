using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

// Read-only WinRT probe. Runs as a packaged child, without a script host.
internal static class PwhStoreUpdateCheck {
  static object Property(object value,string name) { var type=value.GetType();var property=type.GetProperty(name);return property!=null?property.GetValue(value,null):type.GetField(name).GetValue(value); }
  static Type WinRT(string name,string assembly) { return Type.GetType(name+", "+assembly+", ContentType=WindowsRuntime",true); }
  static int Main() {
    Console.OutputEncoding=new UTF8Encoding(false);
    try {
      var packageType=WinRT("Windows.ApplicationModel.Package","Windows.ApplicationModel");
      object package=packageType.GetProperty("Current").GetValue(null,null),id=Property(package,"Id");
      if((string)Property(id,"Name")!="STOOMLab.PwhDesktop" || (string)Property(id,"FamilyName")!="STOOMLab.PwhDesktop_g8ykese288rn6")throw new InvalidOperationException();
      var contextType=WinRT("Windows.Services.Store.StoreContext","Windows.Services.Store");
      object context=contextType.GetMethod("GetDefault").Invoke(null,null);
      object operation=contextType.GetMethod("GetAppAndOptionalStorePackageUpdatesAsync").Invoke(context,null);
      var resultType=typeof(IReadOnlyList<>).MakeGenericType(WinRT("Windows.Services.Store.StorePackageUpdate","Windows.Services.Store"));
      var runtime=System.Runtime.InteropServices.RuntimeEnvironment.GetRuntimeDirectory();
      var extensions=Assembly.LoadFrom(System.IO.Path.Combine(runtime,"System.Runtime.WindowsRuntime.dll")).GetType("System.WindowsRuntimeSystemExtensions",true);
      Task task=null;
      foreach(var method in extensions.GetMethods()) {
        if(method.Name=="AsTask" && method.IsGenericMethodDefinition && method.GetGenericArguments().Length==1 && method.GetParameters().Length==1) {
          task=(Task)method.MakeGenericMethod(resultType).Invoke(null,new object[]{operation});break;
        }
      }
      if(task==null || !task.Wait(15000))throw new TimeoutException();
      bool available=false;
      foreach(object update in (IEnumerable)Property(task,"Result")) {
        object candidate=Property(update,"Package"),candidateId=Property(candidate,"Id");
        if((string)Property(candidateId,"FamilyName")=="STOOMLab.PwhDesktop_g8ykese288rn6"
          && !(bool)Property(candidate,"IsFramework") && !(bool)Property(candidate,"IsResourcePackage") && !(bool)Property(candidate,"IsOptional"))available=true;
      }
      object version=Property(id,"Version");
      string text=Property(version,"Major")+"."+Property(version,"Minor")+"."+Property(version,"Build")+"."+Property(version,"Revision");
      Console.WriteLine("{\"schema\":1,\"packageName\":\"STOOMLab.PwhDesktop\",\"familyName\":\"STOOMLab.PwhDesktop_g8ykese288rn6\",\"currentVersion\":\""+text+"\",\"status\":\""+(available?"available":"current")+"\"}");
    } catch { Console.WriteLine("{\"schema\":1,\"status\":\"unavailable\"}"); }
    return 0;
  }
}
