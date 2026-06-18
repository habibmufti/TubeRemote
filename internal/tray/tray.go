package tray

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/getlantern/systray"
)

type Config struct {
	Version string
	Port    int
	Token   string
	OnQuit  func()
}

// Run starts the system tray icon. Blocks until the user quits.
// Must be called from the main goroutine.
func Run(cfg Config) {
	systray.Run(func() {
		systray.SetIcon(icon)
		systray.SetTitle("TubeRemote")
		systray.SetTooltip(fmt.Sprintf("TubeRemote %s — :%d", cfg.Version, cfg.Port))

		mTitle := systray.AddMenuItem(fmt.Sprintf("TubeRemote %s", cfg.Version), "")
		mTitle.Disable()
		systray.AddSeparator()

		mOpen := systray.AddMenuItem("Open in Browser", fmt.Sprintf("http://localhost:%d", cfg.Port))
		systray.AddSeparator()

		mQuit := systray.AddMenuItem("Quit", "Stop TubeRemote")

		go func() {
			for {
				select {
				case <-mOpen.ClickedCh:
					openBrowser(fmt.Sprintf("http://localhost:%d", cfg.Port))
				case <-mQuit.ClickedCh:
					systray.Quit()
				}
			}
		}()
	}, func() {
		if cfg.OnQuit != nil {
			cfg.OnQuit()
		}
	})
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
