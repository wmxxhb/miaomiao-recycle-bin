using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

public class RemovedItem { public string path {get;set;} public bool directory {get;set;} }
public static class ShellRefresh {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    private static extern void SHChangeNotify(uint eventId, uint flags, [MarshalAs(UnmanagedType.LPWStr)] string item1, IntPtr item2);
    public static int Main() {
        try {
            var items = new JavaScriptSerializer().Deserialize<RemovedItem[]>(Console.In.ReadToEnd());
            var parents = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in items) {
                if (!Path.IsPathRooted(item.path)) return 2;
                // This helper only informs Explorer of completed operations. It never deletes files.
                SHChangeNotify(item.directory ? 0x10u : 0x4u, 0x1005u, item.path, IntPtr.Zero);
                parents.Add(Path.GetDirectoryName(item.path));
            }
            foreach(var parent in parents) SHChangeNotify(0x1000u, 0x1005u, parent, IntPtr.Zero);
            return 0;
        } catch { return 1; }
    }
}
