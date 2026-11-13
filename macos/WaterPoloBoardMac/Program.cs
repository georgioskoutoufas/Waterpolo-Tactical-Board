using System;
using System.IO;
using System.Runtime.InteropServices;

namespace WaterPoloBoardMac
{
    [StructLayout(LayoutKind.Sequential)]
    public struct CGPoint
    {
        public double x;
        public double y;
        public CGPoint(double x, double y) { this.x = x; this.y = y; }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CGSize
    {
        public double width;
        public double height;
        public CGSize(double width, double height) { this.width = width; this.height = height; }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CGRect
    {
        public CGPoint origin;
        public CGSize size;
        public CGRect(double x, double y, double width, double height)
        {
            this.origin = new CGPoint(x, y);
            this.size = new CGSize(width, height);
        }
    }

    internal static class ObjC
    {
        private const string LibObjC = "/usr/lib/libobjc.A.dylib";
        private const string LibDl = "/usr/lib/libSystem.B.dylib";

        [DllImport(LibDl)]
        public static extern IntPtr dlopen(string path, int mode);

        [DllImport(LibObjC)]
        public static extern IntPtr objc_getClass(string name);

        [DllImport(LibObjC)]
        public static extern IntPtr sel_registerName(string name);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector, IntPtr arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector, IntPtr arg1, IntPtr arg2);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector, string utf8Str);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector, long arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector, ulong arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern void SendVoid(IntPtr receiver, IntPtr selector);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern void SendVoid(IntPtr receiver, IntPtr selector, IntPtr arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern void SendVoid(IntPtr receiver, IntPtr selector, bool arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern void SendVoid(IntPtr receiver, IntPtr selector, long arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern void SendVoid(IntPtr receiver, IntPtr selector, ulong arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern bool SendBool(IntPtr receiver, IntPtr selector, long arg1);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendInitWindow(
            IntPtr receiver,
            IntPtr selector,
            CGRect contentRect,
            ulong styleMask,
            ulong backing,
            bool defer);

        [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
        public static extern IntPtr SendInitWebView(
            IntPtr receiver,
            IntPtr selector,
            CGRect frame,
            IntPtr configuration);

        public static IntPtr NSString(string str)
        {
            IntPtr cls = objc_getClass("NSString");
            IntPtr sel = sel_registerName("stringWithUTF8String:");
            return SendPtr(cls, sel, str);
        }

        public static IntPtr FileURL(string path)
        {
            IntPtr cls = objc_getClass("NSURL");
            IntPtr sel = sel_registerName("fileURLWithPath:");
            return SendPtr(cls, sel, NSString(path));
        }
    }

    internal static class Program
    {
        static void Main(string[] args)
        {
            // Load native macOS Cocoa & WebKit frameworks
            ObjC.dlopen("/System/Library/Frameworks/Foundation.framework/Foundation", 2);
            ObjC.dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", 2);
            ObjC.dlopen("/System/Library/Frameworks/WebKit.framework/WebKit", 2);

            // 1. Initialize NSApplication
            IntPtr nsAppClass = ObjC.objc_getClass("NSApplication");
            IntPtr app = ObjC.SendPtr(nsAppClass, ObjC.sel_registerName("sharedApplication"));

            // NSApplicationActivationPolicyRegular = 0
            ObjC.SendBool(app, ObjC.sel_registerName("setActivationPolicy:"), 0);

            // 2. Create NSWindow (1340 x 860, Titled | Closable | Miniaturizable | Resizable = 1|2|4|8 = 15)
            IntPtr nsWindowClass = ObjC.objc_getClass("NSWindow");
            IntPtr windowAlloc = ObjC.SendPtr(nsWindowClass, ObjC.sel_registerName("alloc"));
            CGRect rect = new CGRect(0, 0, 1340, 860);
            ulong styleMask = (1UL << 0) | (1UL << 1) | (1UL << 2) | (1UL << 3);
            IntPtr window = ObjC.SendInitWindow(
                windowAlloc,
                ObjC.sel_registerName("initWithContentRect:styleMask:backing:defer:"),
                rect,
                styleMask,
                2UL, // NSBackingStoreBuffered
                false
            );

            ObjC.SendVoid(
                window,
                ObjC.sel_registerName("setTitle:"),
                ObjC.NSString("Πινακάκι Τακτικής Πόλο - Water Polo Tactical Board Pro v1.5 (Alpha)")
            );

            // Enable native macOS FullScreen button (NSWindowCollectionBehaviorFullScreenPrimary = 1 << 7)
            ObjC.SendVoid(window, ObjC.sel_registerName("setCollectionBehavior:"), 1UL << 7);
            ObjC.SendVoid(window, ObjC.sel_registerName("center"));

            // 3. Create WKWebViewConfiguration & enable fullscreen + local file access
            IntPtr wkConfigClass = ObjC.objc_getClass("WKWebViewConfiguration");
            IntPtr wkConfig = ObjC.SendPtr(
                ObjC.SendPtr(wkConfigClass, ObjC.sel_registerName("alloc")),
                ObjC.sel_registerName("init")
            );

            IntPtr prefs = ObjC.SendPtr(wkConfig, ObjC.sel_registerName("preferences"));
            if (prefs != IntPtr.Zero)
            {
                IntPtr yesNum = ObjC.SendPtr(ObjC.objc_getClass("NSNumber"), ObjC.sel_registerName("numberWithBool:"), 1L);
                ObjC.SendPtr(
                    prefs,
                    ObjC.sel_registerName("setValue:forKey:"),
                    yesNum,
                    ObjC.NSString("allowFileAccessFromFileURLs")
                );
                ObjC.SendPtr(
                    prefs,
                    ObjC.sel_registerName("setValue:forKey:"),
                    yesNum,
                    ObjC.NSString("fullScreenEnabled")
                );
            }

            // 4. Create WKWebView
            IntPtr wkWebViewClass = ObjC.objc_getClass("WKWebView");
            IntPtr webViewAlloc = ObjC.SendPtr(wkWebViewClass, ObjC.sel_registerName("alloc"));
            IntPtr webView = ObjC.SendInitWebView(
                webViewAlloc,
                ObjC.sel_registerName("initWithFrame:configuration:"),
                rect,
                wkConfig
            );

            // NSViewWidthSizable (2) | NSViewHeightSizable (16) = 18
            ObjC.SendVoid(webView, ObjC.sel_registerName("setAutoresizingMask:"), 18UL);

            // 5. Locate bundled assets/index.html inside WaterPoloBoard.app/Contents/Resources/assets/
            string exeDir = AppContext.BaseDirectory;
            string resourcesAssetsDir = Path.GetFullPath(Path.Combine(exeDir, "..", "Resources", "assets"));
            if (!Directory.Exists(resourcesAssetsDir))
            {
                resourcesAssetsDir = Path.Combine(exeDir, "assets");
            }
            string indexPath = Path.Combine(resourcesAssetsDir, "index.html");

            IntPtr fileUrl = ObjC.FileURL(indexPath);
            IntPtr readDirUrl = ObjC.FileURL(resourcesAssetsDir);
            ObjC.SendPtr(
                webView,
                ObjC.sel_registerName("loadFileURL:allowingReadAccessToURL:"),
                fileUrl,
                readDirUrl
            );

            // 6. Attach WKWebView to NSWindow & run Cocoa event loop
            ObjC.SendVoid(window, ObjC.sel_registerName("setContentView:"), webView);
            ObjC.SendVoid(window, ObjC.sel_registerName("makeKeyAndOrderFront:"), IntPtr.Zero);
            ObjC.SendVoid(app, ObjC.sel_registerName("activateIgnoringOtherApps:"), true);
            ObjC.SendVoid(app, ObjC.sel_registerName("run"));
        }
    }
}
