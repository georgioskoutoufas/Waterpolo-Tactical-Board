using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WaterPoloBoard
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new MainForm());
        }
    }

    public class MainForm : Form
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        private WebView2 webView;
        private FormWindowState _prevWindowState = FormWindowState.Normal;

        public MainForm()
        {
            this.Text = "Waterpolo Tactical Board";
            this.Size = new Size(1340, 860);
            this.MinimumSize = new Size(960, 600);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.WindowState = FormWindowState.Normal;
            this.BackColor = Color.FromArgb(9, 13, 22); // Match #090d16

            ApplyDarkTitleBar();

            // Load window icon from file or embedded resource
            try
            {
                string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app.ico");
                if (File.Exists(iconPath))
                {
                    this.Icon = new Icon(iconPath);
                }
                else
                {
                    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("WaterPoloBoard.EmbeddedAssets.icon.ico");
                    if (stream != null)
                    {
                        this.Icon = new Icon(stream);
                    }
                }
            }
            catch { }

            webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(9, 13, 22)
            };

            this.Controls.Add(webView);
            this.Load += async (s, e) => await InitializeWebViewAsync();
        }

        private void ApplyDarkTitleBar()
        {
            try
            {
                int darkMode = 1;
                DwmSetWindowAttribute(this.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));
            }
            catch { }
        }

        private async Task InitializeWebViewAsync()
        {
            try
            {
                string assetsDir = EnsureAssetsExtracted();
                string userDataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WaterPoloBoard", "WebView2Data");

                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);

                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                webView.CoreWebView2.Settings.IsPinchZoomEnabled = false;

                webView.CoreWebView2.ContainsFullScreenElementChanged += (sender, args) =>
                {
                    if (webView.CoreWebView2.ContainsFullScreenElement)
                    {
                        _prevWindowState = this.WindowState;
                        this.WindowState = FormWindowState.Normal;
                        this.FormBorderStyle = FormBorderStyle.None;
                        this.WindowState = FormWindowState.Maximized;
                    }
                    else
                    {
                        this.FormBorderStyle = FormBorderStyle.Sizable;
                        this.WindowState = _prevWindowState;
                    }
                };

                // Allow popup windows (e.g. Google Sign-In)
                webView.CoreWebView2.NewWindowRequested += (sender, args) =>
                {
                    args.Handled = false;
                };

                // Map virtual host name so everything runs as https://localhost/ (Authorized Firebase domain!)
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "localhost",
                    assetsDir,
                    CoreWebView2HostResourceAccessKind.Allow
                );

                webView.CoreWebView2.Navigate("https://localhost/index.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Σφάλμα κατά την εκκίνηση του πίνακα:\n\n" + ex.Message +
                    "\n\nΒεβαιωθείτε ότι είναι εγκατεστημένο το Microsoft Edge WebView2 Runtime.",
                    "Water Polo Board",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private string EnsureAssetsExtracted()
        {
            // 1. If an 'assets' folder is located next to the exe, prefer it
            string localAssets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets");
            if (Directory.Exists(localAssets) && File.Exists(Path.Combine(localAssets, "index.html")))
            {
                return localAssets;
            }

            // 2. Otherwise extract embedded resources to LocalAppData
            string targetDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WaterPoloBoard", "AppAssets");
            try
            {
                if (Directory.Exists(targetDir))
                {
                    Directory.Delete(targetDir, true);
                }
            }
            catch { }
            Directory.CreateDirectory(targetDir);

            var assembly = Assembly.GetExecutingAssembly();
            string resourcePrefix = "WaterPoloBoard.EmbeddedAssets.";

            foreach (string resName in assembly.GetManifestResourceNames())
            {
                if (!resName.StartsWith(resourcePrefix)) continue;
                string relativeName = resName.Substring(resourcePrefix.Length);

                string filePath = Path.Combine(targetDir, relativeName);
                using (var stream = assembly.GetManifestResourceStream(resName))
                {
                    if (stream != null)
                    {
                        using var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write);
                        stream.CopyTo(fileStream);
                    }
                }
            }

            return targetDir;
        }
    }
}
