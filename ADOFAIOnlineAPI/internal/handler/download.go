package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Download 下载 bundle 文件 handler
// GET /download/{path} 支持根目录文件及平台子目录，如 /download/ADOFAIOL.dll.bytes 或 /download/Android/adofaiol.resources.assets.bundle
func Download(bundlesPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodOptions {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusMethodNotAllowed)
			w.Write([]byte(`{"error":"Method not allowed"}`))
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/download/")
		if path == "" || strings.Contains(path, "..") || strings.HasPrefix(path, "/") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"invalid path"}`))
			return
		}

		// 防止路径穿越，确保解析后的路径在 bundlesPath 下
		filePath := filepath.Clean(filepath.Join(bundlesPath, path))
		absPath, err := filepath.Abs(filePath)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"invalid path"}`))
			return
		}
		absBundles, _ := filepath.Abs(bundlesPath)
		if !strings.HasPrefix(absPath, absBundles+string(filepath.Separator)) && absPath != absBundles {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"access denied"}`))
			return
		}

		info, err := os.Stat(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"file unavailable"}`))
			}
			return
		}
		if info.IsDir() {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"access denied"}`))
			return
		}

		// ETag 基于文件修改时间和大小，文件更新后 ETag 变化，缓存会失效
		etag := fmt.Sprintf(`"%d-%d"`, info.ModTime().UnixNano(), info.Size())
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "public, max-age=86400, must-revalidate")
		http.ServeFile(w, r, filePath)
	}
}
