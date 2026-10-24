package handler

import (
	"net/http"
	"path/filepath"
	"strings"
)

// ServeUploadedFile 提供上传文件的访问
// GET /files/{path}
func ServeUploadedFile(uploadDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodOptions {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusMethodNotAllowed)
			w.Write([]byte(`{"error":"Method not allowed"}`))
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/files/")
		if path == "" || strings.Contains(path, "..") || strings.HasPrefix(path, "/") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"invalid path"}`))
			return
		}

		// 防止路径穿越
		filePath := filepath.Clean(filepath.Join(uploadDir, path))
		absPath, err := filepath.Abs(filePath)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"invalid path"}`))
			return
		}
		absUpload, _ := filepath.Abs(uploadDir)
		if !strings.HasPrefix(absPath, absUpload+string(filepath.Separator)) && absPath != absUpload {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"access denied"}`))
			return
		}

		// 设置缓存
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, filePath)
	}
}
