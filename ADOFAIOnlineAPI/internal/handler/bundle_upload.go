package handler

import (
	"archive/zip"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// 平台参数与 bundle 子目录对应（与 checkupdate 一致）
var bundlePlatformDirs = map[string]string{
	"android": "Android",
	"ios":     "IOS",
	"win":     "StandaloneWindows",
}

// UploadBundle 上传平台 bundle 压缩包：清空该平台目录后解压 zip 到目录内。无需认证。
// POST /upload/bundle   form: platform=android|ios|win, file=<zip>
func UploadBundle(bundlesPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorBundleUpload(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		platform := strings.ToLower(strings.TrimSpace(r.FormValue("platform")))
		if platform == "" {
			jsonErrorBundleUpload(w, "缺少参数 platform (android|ios|win)", http.StatusBadRequest)
			return
		}
		platformDir, ok := bundlePlatformDirs[platform]
		if !ok {
			jsonErrorBundleUpload(w, "platform 必须为 android、ios 或 win", http.StatusBadRequest)
			return
		}

		// 限制请求体大小（例如 500MB）
		const maxSize = 500 << 20
		r.Body = http.MaxBytesReader(w, r.Body, maxSize)
		if err := r.ParseMultipartForm(maxSize); err != nil {
			jsonErrorBundleUpload(w, "请求体过大或格式错误", http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			jsonErrorBundleUpload(w, "请选择要上传的 zip 文件", http.StatusBadRequest)
			return
		}
		defer file.Close()

		if strings.ToLower(filepath.Ext(header.Filename)) != ".zip" {
			jsonErrorBundleUpload(w, "只支持 .zip 格式", http.StatusBadRequest)
			return
		}

		targetDir := filepath.Join(bundlesPath, platformDir)
		absTarget, err := filepath.Abs(targetDir)
		if err != nil {
			jsonErrorBundleUpload(w, "路径解析失败", http.StatusInternalServerError)
			return
		}
		absBundles, _ := filepath.Abs(bundlesPath)
		if !strings.HasPrefix(absTarget, absBundles+string(filepath.Separator)) && absTarget != absBundles {
			jsonErrorBundleUpload(w, "目标路径非法", http.StatusBadRequest)
			return
		}

		// 保存上传的 zip 到临时文件
		tmpF, err := os.CreateTemp("", "bundle-*.zip")
		if err != nil {
			jsonErrorBundleUpload(w, "创建临时文件失败", http.StatusInternalServerError)
			return
		}
		tmpPath := tmpF.Name()
		defer os.Remove(tmpPath)

		_, err = io.Copy(tmpF, file)
		tmpF.Close()
		if err != nil {
			jsonErrorBundleUpload(w, "保存上传文件失败", http.StatusInternalServerError)
			return
		}

		// 清空平台目录内所有内容（保留目录本身）
		if err := removeAllContents(targetDir); err != nil {
			jsonErrorBundleUpload(w, "清空平台目录失败: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// 确保目标目录存在
		if err := os.MkdirAll(targetDir, 0755); err != nil {
			jsonErrorBundleUpload(w, "创建目录失败", http.StatusInternalServerError)
			return
		}

		// 解压 zip 到目标目录（防止 zip slip）
		zr, err := zip.OpenReader(tmpPath)
		if err != nil {
			jsonErrorBundleUpload(w, "无法读取 zip: "+err.Error(), http.StatusBadRequest)
			return
		}
		defer zr.Close()

		for _, f := range zr.File {
			if f.FileInfo().IsDir() {
				continue
			}
			name := f.Name
			if strings.Contains(name, "..") || strings.HasPrefix(name, "/") || filepath.IsAbs(name) {
				continue
			}
			// 只保留文件名，忽略 zip 内子目录（按“根层直接一堆文件”处理）
			baseName := filepath.Base(name)
			if baseName == "." || baseName == ".." {
				continue
			}
			destPath := filepath.Join(targetDir, baseName)
			destAbs, _ := filepath.Abs(destPath)
			if !strings.HasPrefix(destAbs, absTarget+string(filepath.Separator)) && destAbs != absTarget {
				continue
			}
			if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
				jsonErrorBundleUpload(w, "创建解压目录失败", http.StatusInternalServerError)
				return
			}
			out, err := os.Create(destPath)
			if err != nil {
				jsonErrorBundleUpload(w, "创建文件失败: "+destPath, http.StatusInternalServerError)
				return
			}
			rc, err := f.Open()
			if err != nil {
				out.Close()
				jsonErrorBundleUpload(w, "打开 zip 条目失败", http.StatusInternalServerError)
				return
			}
			_, err = io.Copy(out, rc)
			rc.Close()
			out.Close()
			if err != nil {
				jsonErrorBundleUpload(w, "写入文件失败", http.StatusInternalServerError)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"message": "上传并解压成功"})
	}
}

// removeAllContents 删除目录内所有内容，保留该目录本身
func removeAllContents(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		if e.IsDir() {
			if err := os.RemoveAll(path); err != nil {
				return err
			}
		} else {
			if err := os.Remove(path); err != nil {
				return err
			}
		}
	}
	return nil
}

func jsonErrorBundleUpload(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
