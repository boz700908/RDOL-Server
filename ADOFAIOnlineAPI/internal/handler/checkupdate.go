package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// manifest  manifest.json 结构（仅记录版本、公告，文件列表由程序自动扫描）
type manifest struct {
	Version     string `json:"version"`
	Announcement string `json:"announcement"`
}

// CheckUpdateResponse 检查更新 API 响应
type CheckUpdateResponse struct {
	Version     string     `json:"version"`
	Announcement string   `json:"announcement"`
	Platform    string     `json:"platform"`
	Files       []FileInfo `json:"files"`
}

// 支持的平台及对应目录名
var platformDirs = map[string]string{
	"android": "Android",
	"ios":     "IOS",
	"win":     "StandaloneWindows",
}

// FileInfo 文件信息（含运行时计算的哈希和下载链接）
type FileInfo struct {
	Name string `json:"name"`
	Hash string `json:"hash"`
	Size int64  `json:"size"`
	URL  string `json:"url"`
}

// CheckUpdate 检查更新 handler
// GET /checkupdate?platform=android|ios|win 根据平台返回对应 bundle 文件、哈希、版本、更新日志、下载链接
// 根目录程序集(dll.bytes)各平台互通，bundle 包按平台区分
func CheckUpdate(bundlesPath, baseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodOptions {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "Method not allowed"})
			return
		}

		platform := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("platform")))
		if platform == "" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "platform parameter required (android|ios|win)"})
			return
		}
		platformDir, ok := platformDirs[platform]
		if !ok {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid platform (android|ios|win)"})
			return
		}

		url := baseURL
		if url == "" {
			url = getBaseURLFromRequest(r)
		} else {
			url = strings.TrimSuffix(url, "/")
		}

		manifestPath := filepath.Join(bundlesPath, "manifest.json")
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "manifest not found: " + err.Error()})
			return
		}

		var m manifest
		if err := json.Unmarshal(data, &m); err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid manifest: " + err.Error()})
			return
		}

		// 1. 根目录程序集（各平台互通）
		rootFiles, err := listBundleFiles(bundlesPath)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to scan bundles: " + err.Error()})
			return
		}

		// 2. 平台专属 bundle
		platformPath := filepath.Join(bundlesPath, platformDir)
		platformFiles, err := listBundleFiles(platformPath)
		if err != nil {
			platformFiles = nil
		}

		files := make([]FileInfo, 0, len(rootFiles)+len(platformFiles))

		for _, name := range rootFiles {
			filePath := filepath.Join(bundlesPath, name)
			hash, size, err := hashFile(filePath)
			if err != nil {
				continue
			}
			downloadPath := name
			// 使用 hash 前 16 位作为 cache-busting 参数，避免 CDN/代理 返回旧版本文件
			files = append(files, FileInfo{
				Name: name,
				Hash: "sha256:" + hash,
				Size: size,
				URL:  url + "/download/" + downloadPath + "?h=" + hash[:16],
			})
		}

		for _, name := range platformFiles {
			filePath := filepath.Join(platformPath, name)
			hash, size, err := hashFile(filePath)
			if err != nil {
				continue
			}
			downloadPath := platformDir + "/" + name
			// 使用 hash 前 16 位作为 cache-busting 参数，避免 CDN/代理 返回旧版本文件
			files = append(files, FileInfo{
				Name: downloadPath,
				Hash: "sha256:" + hash,
				Size: size,
				URL:  url + "/download/" + downloadPath + "?h=" + hash[:16],
			})
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(CheckUpdateResponse{
			Version:     m.Version,
			Announcement: m.Announcement,
			Platform:    platform,
			Files:       files,
		})
	}
}

// listBundleFiles 扫描 bundles 目录，返回除 json、meta 外的所有文件
func listBundleFiles(bundlesPath string) ([]string, error) {
	entries, err := os.ReadDir(bundlesPath)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if ext == ".json" || ext == ".meta" {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", 0, err
	}

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", 0, err
	}

	return hex.EncodeToString(h.Sum(nil)), info.Size(), nil
}

// getBaseURLFromRequest 从请求自动检测 base URL（支持反向代理）
func getBaseURLFromRequest(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = strings.ToLower(strings.TrimSpace(proto))
	}

	host := r.Host
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		host = strings.TrimSpace(h)
	}

	return scheme + "://" + host
}
