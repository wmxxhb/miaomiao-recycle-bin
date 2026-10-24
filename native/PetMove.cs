using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

// Move the pet in physical pixels, without asking Windows/Electron to resize it.
// The helper is restricted to the one HWND owned by its launching app process.
public static class PetMove {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    const uint MoveOnly = 0x0001 | 0x0004 | 0x0010 | 0x0200; // NOSIZE | NOZORDER | NOACTIVATE | NOOWNERZORDER
    static readonly object gate = new object();
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static IntPtr window;
    static Timer timer;
    static int session;
    static bool active, dragged;
    static Point startCursor;
    static Rect startRect;
    static int lastX, lastY, moves;
    static void Write(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    static void Finish(bool cancelled) {
        if(!active) return;
        active=false;
        timer.Change(Timeout.Infinite, Timeout.Infinite);
        Rect end;
        GetWindowRect(window,out end);
        Write(new { kind="end",id=session,dragged=dragged,cancelled=cancelled,moves=moves,
            start=new[]{startRect.left,startRect.top,startRect.right-startRect.left,startRect.bottom-startRect.top},
            end=new[]{end.left,end.top,end.right-end.left,end.bottom-end.top} });
    }
    static void Tick(object unused) {
        lock(gate) {
            if(!active) return;
            SetThreadDpiAwarenessContext(new IntPtr(-4));
            if(!IsWindow(window) || (GetAsyncKeyState(1)&0x8000)==0) { Finish(false);return; }
            Point cursor;
            if(!GetCursorPos(out cursor)) { Finish(true);return; }
            int dx=cursor.x-startCursor.x, dy=cursor.y-startCursor.y;
            if(!dragged && dx*dx+dy*dy<64) return;
            dragged=true;
            int x=startRect.left+dx,y=startRect.top+dy;
            if(x==lastX&&y==lastY)return;
            if(!SetWindowPos(window,IntPtr.Zero,x,y,0,0,MoveOnly)) { Finish(true);return; }
            lastX=x;lastY=y;moves++;
            Write(new {kind="move",bounds=new[]{x,y,startRect.right-startRect.left,startRect.bottom-startRect.top}});
        }
    }
    public static int Main(string[] args) {
        if(args.Length!=2)return 2;
        window=new IntPtr(long.Parse(args[0]));uint owner;
        GetWindowThreadProcessId(window,out owner);
        if(owner!=uint.Parse(args[1]))return 3;
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        timer=new Timer(Tick,null,Timeout.Infinite,Timeout.Infinite);
        Write(new {kind="ready"});
        string line;
        while((line=Console.ReadLine())!=null) {
            try {
                var cmd=json.Deserialize<Command>(line);
                lock(gate) {
                    if(cmd.command=="cancel") {Finish(true);continue;}
                    if(cmd.command=="begin") {
                        Finish(true);
                        session=cmd.id;dragged=false;moves=0;
                        GetCursorPos(out startCursor);GetWindowRect(window,out startRect);
                        lastX=startRect.left;lastY=startRect.top;active=true;
                        timer.Change(0,16);
                    }
                    if(cmd.command=="position" || cmd.command=="bounds") {
                        if(active)continue;
                        bool resize=cmd.command=="bounds";
                        if(resize && (cmd.width<1||cmd.height<1||cmd.width>20000||cmd.height>20000))throw new Exception("Invalid window size");
                        if(!SetWindowPos(window,IntPtr.Zero,cmd.x,cmd.y,cmd.width,cmd.height,resize?MoveOnly&~0x0001u:MoveOnly))throw new Exception("Window movement failed");
                        Rect rect;GetWindowRect(window,out rect);
                        Write(new {kind="position",id=cmd.id,bounds=new[]{rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top}});
                    }
                }
            } catch(Exception error) {Write(new {kind="error",message=error.Message});}
        }
        lock(gate){Finish(true);timer.Dispose();}
        return 0;
    }
    public class Command { public string command {get;set;} public int id {get;set;} public int x {get;set;} public int y {get;set;} public int width {get;set;} public int height {get;set;} }
}
