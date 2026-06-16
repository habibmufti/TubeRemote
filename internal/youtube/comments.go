// Package youtube fetches data from YouTube's internal "innertube" API —
// the same private endpoints the web client (and tools like yt-dlp) use.
// No API key registration is needed: the web client key below is public and stable.
package youtube

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Comment is a single top-level comment as shown below the player.
type Comment struct {
	Author string `json:"author"`
	Text   string `json:"text"`
	Likes  string `json:"likes"`
	Avatar string `json:"avatar"`
}

const (
	innertubeKey  = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
	clientVersion = "2.20240711.01.00"
	userAgent     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

var httpClient = &http.Client{Timeout: 12 * time.Second}

// FetchComments returns up to `limit` top-level comments for a video.
// It makes two innertube calls: one to get the comment-section continuation
// token, and one to load the first page of comments.
func FetchComments(videoID string, limit int) ([]Comment, error) {
	first, err := innertubeNext(map[string]any{"videoId": videoID}, videoID)
	if err != nil {
		return nil, err
	}

	token := findCommentToken(first)
	if token == "" {
		// Comments disabled, or none yet — not an error.
		return []Comment{}, nil
	}

	page, err := innertubeNext(map[string]any{"continuation": token}, videoID)
	if err != nil {
		return nil, err
	}
	return parseComments(page, limit), nil
}

func innertubeNext(extra map[string]any, videoID string) (map[string]any, error) {
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

	url := "https://www.youtube.com/youtubei/v1/next?key=" + innertubeKey + "&prettyPrint=false"
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

func parseComments(resp map[string]any, limit int) []Comment {
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

	var items []any
	for _, ep := range slice(resp["onResponseReceivedEndpoints"]) {
		items = append(items, slice(get(ep, "reloadContinuationItemsCommand", "continuationItems"))...)
		items = append(items, slice(get(ep, "appendContinuationItemsCommand", "continuationItems"))...)
	}

	out := []Comment{}
	for _, it := range items {
		if len(out) >= limit {
			break
		}
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
			if len(out) >= limit {
				break
			}
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
