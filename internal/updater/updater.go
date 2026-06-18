package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"

	"github.com/inconshreveable/go-update"
)

const apiURL = "https://api.github.com/repos/habibmufti/TubeRemote/releases/latest"

type ghRelease struct {
	TagName string    `json:"tag_name"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// CheckAndNotify prints a message if a newer version is available. Runs in background.
func CheckAndNotify(current string) {
	if current == "dev" {
		return
	}
	go func() {
		tag, _, err := check(current)
		if err != nil || tag == "" {
			return
		}
		fmt.Printf("\n  Update available: %s (current: %s)\n", tag, current)
		fmt.Printf("  Run with --update to install.\n\n")
	}()
}

// Apply downloads and applies the latest release, replacing the running binary.
func Apply(current string) error {
	tag, url, err := check(current)
	if err != nil {
		return fmt.Errorf("checking for updates: %w", err)
	}
	if tag == "" {
		fmt.Println("Already up to date.")
		return nil
	}
	if url == "" {
		return fmt.Errorf("no release asset found for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	fmt.Printf("Downloading %s...\n", tag)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("downloading update: %w", err)
	}
	defer resp.Body.Close()

	fmt.Println("Applying update...")
	if err := update.Apply(resp.Body, update.Options{}); err != nil {
		return fmt.Errorf("applying update: %w", err)
	}
	fmt.Println("Updated successfully. Please restart TubeRemote.")
	return nil
}

// check fetches the latest release. Returns tag and download URL, or empty strings
// if already on the latest version or no matching asset exists.
func check(current string) (tag, url string, err error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, apiURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	var rel ghRelease
	if err = json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return
	}

	tag = rel.TagName
	latestVer := strings.TrimPrefix(tag, "v")
	if latestVer == current || tag == current {
		tag = ""
		return
	}

	suffix := assetSuffix()
	for _, a := range rel.Assets {
		if strings.HasSuffix(a.Name, suffix) {
			url = a.BrowserDownloadURL
			return
		}
	}
	return
}

func assetSuffix() string {
	switch runtime.GOOS {
	case "windows":
		return fmt.Sprintf("windows-%s.exe", runtime.GOARCH)
	case "darwin":
		return fmt.Sprintf("darwin-%s", runtime.GOARCH)
	default:
		return fmt.Sprintf("linux-%s", runtime.GOARCH)
	}
}
