// Package youtube fetches data from YouTube's internal "innertube" API —
// the same private endpoints the web client (and tools like yt-dlp) use.
// No API key registration is needed: the public web-client key is scraped from
// youtube.com at runtime (see innertubeAPIKey) and cached for the process.
package youtube

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Comment is a single top-level comment as shown below the player.
type Comment struct {
	Author string `json:"author"`
	Text   string `json:"text"`
	Likes  string `json:"likes"`
	Avatar string `json:"avatar"`
}

// CommentPage is one page of comments plus a token to fetch the next page
// (empty when there are no more).
type CommentPage struct {
	Comments     []Comment `json:"comments"`
	Continuation string    `json:"continuation"`
}

// VideoInfo holds lightweight metadata shown alongside the player.
type VideoInfo struct {
	Description string `json:"description"`
	Author      string `json:"author"`
	Views       string `json:"views"`
}

const (
	clientVersion = "2.20240711.01.00"
	userAgent     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

var httpClient = &http.Client{Timeout: 12 * time.Second}

// innertube web-client key, scraped from youtube.com on first use and cached.
var (
	keyMu     sync.Mutex
	cachedKey string
	keyRe     = regexp.MustCompile(`"INNERTUBE_API_KEY":"([^"]+)"`)
)

// innertubeAPIKey returns YouTube's public web-client API key. It scrapes the
// key from the youtube.com home page on first call and caches it for the rest
// of the process. This key is a fixed, public constant shipped in YouTube's web
// page (the same one used by yt-dlp and the browser) — not a personal secret —
// but fetching it at runtime keeps it out of the source and survives the rare
// case where YouTube rotates it.
func innertubeAPIKey() (string, error) {
	keyMu.Lock()
	defer keyMu.Unlock()
	if cachedKey != "" {
		return cachedKey, nil
	}

	req, err := http.NewRequest(http.MethodGet, "https://www.youtube.com/", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Cookie", "SOCS=CAI") // skips EU consent interstitial

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch youtube.com: status %d", resp.StatusCode)
	}

	html, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	m := keyRe.FindSubmatch(html)
	if m == nil {
		return "", fmt.Errorf("innertube api key not found on youtube.com")
	}
	cachedKey = string(m[1])
	return cachedKey, nil
}

// FetchComments returns the first page of top-level comments for a video,
// along with a continuation token for the next page. It makes two innertube
// calls: one to get the comment-section continuation token, and one to load
// the first page.
func FetchComments(videoID string) (CommentPage, error) {
	first, err := innertubeNext(map[string]any{"videoId": videoID}, videoID)
	if err != nil {
		return CommentPage{Comments: []Comment{}}, err
	}

	token := findCommentToken(first)
	if token == "" {
		// Comments disabled, or none yet — not an error.
		return CommentPage{Comments: []Comment{}}, nil
	}
	return fetchCommentPage(token, videoID)
}

// FetchCommentPage loads a further page of comments from a continuation token
// returned by a previous call.
func FetchCommentPage(token string) (CommentPage, error) {
	return fetchCommentPage(token, "")
}

func fetchCommentPage(token, videoID string) (CommentPage, error) {
	page, err := innertubeNext(map[string]any{"continuation": token}, videoID)
	if err != nil {
		return CommentPage{Comments: []Comment{}}, err
	}
	return CommentPage{
		Comments:     parseComments(page),
		Continuation: findContinuationToken(page),
	}, nil
}

// FetchVideoInfo returns the description and basic metadata via the player endpoint.
func FetchVideoInfo(videoID string) (VideoInfo, error) {
	resp, err := innertubeCall("player", map[string]any{"videoId": videoID}, videoID)
	if err != nil {
		return VideoInfo{}, err
	}
	vd := get(resp, "videoDetails")
	return VideoInfo{
		Description: str(get(vd, "shortDescription")),
		Author:      str(get(vd, "author")),
		Views:       str(get(vd, "viewCount")),
	}, nil
}

func innertubeNext(extra map[string]any, videoID string) (map[string]any, error) {
	return innertubeCall("next", extra, videoID)
}

func innertubeCall(endpoint string, extra map[string]any, videoID string) (map[string]any, error) {
	body := map[string]any{
		"context": map[string]any{
			"client": map[string]any{
				"clientName":    "WEB",
				"clientVersion": clientVersion,
				"hl":            "en",
				"gl":            "US",
			},
		},
	}
	for k, v := range extra {
		body[k] = v
	}
	buf, _ := json.Marshal(body)

	key, err := innertubeAPIKey()
	if err != nil {
		return nil, err
	}
	url := "https://www.youtube.com/youtubei/v1/" + endpoint + "?key=" + key + "&prettyPrint=false"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Origin", "https://www.youtube.com")
	req.Header.Set("Referer", "https://www.youtube.com/watch?v="+videoID)
	req.Header.Set("X-Youtube-Client-Name", "1")
	req.Header.Set("X-Youtube-Client-Version", clientVersion)
	req.Header.Set("Cookie", "SOCS=CAI") // skips EU consent interstitial

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("innertube status %d", resp.StatusCode)
	}

	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// findCommentToken locates the continuation token of the comments section.
func findCommentToken(resp map[string]any) string {
	var walk func(v any) string
	walk = func(v any) string {
		switch t := v.(type) {
		case map[string]any:
			if isr, ok := t["itemSectionRenderer"].(map[string]any); ok {
				if str(isr["sectionIdentifier"]) == "comment-item-section" {
					if tok := findTokenDeep(isr); tok != "" {
						return tok
					}
				}
			}
			for _, vv := range t {
				if r := walk(vv); r != "" {
					return r
				}
			}
		case []any:
			for _, vv := range t {
				if r := walk(vv); r != "" {
					return r
				}
			}
		}
		return ""
	}
	return walk(resp)
}

// findTokenDeep returns the first continuationCommand.token found under a node.
func findTokenDeep(v any) string {
	switch t := v.(type) {
	case map[string]any:
		if cc, ok := t["continuationCommand"].(map[string]any); ok {
			if tok := str(cc["token"]); tok != "" {
				return tok
			}
		}
		for _, vv := range t {
			if r := findTokenDeep(vv); r != "" {
				return r
			}
		}
	case []any:
		for _, vv := range t {
			if r := findTokenDeep(vv); r != "" {
				return r
			}
		}
	}
	return ""
}

// continuationItems gathers the continuation items from a response endpoint.
// The first comment page uses *Command wrappers; later pages use *Action ones.
func continuationItems(resp map[string]any) []any {
	var items []any
	for _, ep := range slice(resp["onResponseReceivedEndpoints"]) {
		for _, key := range []string{
			"reloadContinuationItemsCommand", "appendContinuationItemsCommand",
			"reloadContinuationItemsAction", "appendContinuationItemsAction",
		} {
			items = append(items, slice(get(ep, key, "continuationItems"))...)
		}
	}
	return items
}

// findContinuationToken returns the token to load the next page of comments,
// found in the trailing (top-level) continuationItemRenderer — empty on the last page.
func findContinuationToken(page map[string]any) string {
	for _, it := range continuationItems(page) {
		cir := get(it, "continuationItemRenderer")
		if cir == nil {
			continue
		}
		if tok := str(get(cir, "continuationEndpoint", "continuationCommand", "token")); tok != "" {
			return tok
		}
		if tok := str(get(cir, "button", "buttonRenderer", "command", "continuationCommand", "token")); tok != "" {
			return tok
		}
	}
	return ""
}

func parseComments(resp map[string]any) []Comment {
	// Modern YouTube stores comment data in "entity" mutations keyed by id;
	// the continuation items only reference those keys.
	entities := map[string]map[string]any{}
	for _, m := range slice(get(resp, "frameworkUpdates", "entityBatchUpdate", "mutations")) {
		if p, ok := get(m, "payload", "commentEntityPayload").(map[string]any); ok {
			if key := str(p["key"]); key != "" {
				entities[key] = p
			}
		}
	}

	out := []Comment{}
	for _, it := range continuationItems(resp) {
		ctr := get(it, "commentThreadRenderer")
		if ctr == nil {
			continue
		}
		// New format: resolve the entity by its key.
		if key := str(get(ctr, "commentViewModel", "commentViewModel", "commentKey")); key != "" {
			if p := entities[key]; p != nil {
				if c := commentFromEntity(p); c.Text != "" {
					out = append(out, c)
				}
				continue
			}
		}
		// Legacy format: data lives directly in the renderer.
		if cr, ok := get(ctr, "comment", "commentRenderer").(map[string]any); ok {
			if c := commentFromRenderer(cr); c.Text != "" {
				out = append(out, c)
			}
		}
	}

	// Fallback: if item linkage changed, surface whatever entities we have.
	if len(out) == 0 {
		for _, p := range entities {
			if c := commentFromEntity(p); c.Text != "" {
				out = append(out, c)
			}
		}
	}
	return out
}

func commentFromEntity(p map[string]any) Comment {
	return Comment{
		Author: str(get(p, "author", "displayName")),
		Text:   str(get(p, "properties", "content", "content")),
		Likes:  str(get(p, "toolbar", "likeCountNotliked")),
		Avatar: str(get(p, "author", "avatarThumbnailUrl")),
	}
}

func commentFromRenderer(cr map[string]any) Comment {
	return Comment{
		Author: str(get(cr, "authorText", "simpleText")),
		Text:   runsText(get(cr, "contentText", "runs")),
		Likes:  str(get(cr, "voteCount", "simpleText")),
		Avatar: lastThumb(get(cr, "authorThumbnail", "thumbnails")),
	}
}

// ── small traversal helpers for the deeply-nested, dual-format JSON ──

func get(v any, keys ...string) any {
	cur := v
	for _, k := range keys {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[k]
	}
	return cur
}

func str(v any) string { s, _ := v.(string); return s }

func slice(v any) []any { s, _ := v.([]any); return s }

func runsText(v any) string {
	var b strings.Builder
	for _, r := range slice(v) {
		b.WriteString(str(get(r, "text")))
	}
	return b.String()
}

func lastThumb(v any) string {
	thumbs := slice(v)
	if len(thumbs) == 0 {
		return ""
	}
	return str(get(thumbs[len(thumbs)-1], "url"))
}
