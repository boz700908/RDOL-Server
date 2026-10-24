package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// UploadResponse 上传响应
type UploadResponse struct {
	Filename string `json:"filename"`
	URL      string `json:"url"`
	Size     int64  `json:"size"`
}

// UploadPurchaseReceipt 上传购买凭证照片
// POST /upload/purchase-receipt
func UploadPurchaseReceipt(uploadDir, baseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorUpload(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 限制文件大小为 10MB
		r.ParseMultipartForm(10 << 20)

		file, header, err := r.FormFile("file")
		if err != nil {
			jsonErrorUpload(w, "请选择要上传的文件", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// 检查文件类型
		ext := strings.ToLower(filepath.Ext(header.Filename))
		allowedExts := map[string]bool{
			".jpg":  true,
			".jpeg": true,
			".png":  true,
			".gif":  true,
			".webp": true,
		}
		if !allowedExts[ext] {
			jsonErrorUpload(w, "只支持图片格式：jpg, jpeg, png, gif, webp", http.StatusBadRequest)
			return
		}

		// 检查文件大小
		if header.Size > 10<<20 {
			jsonErrorUpload(w, "文件大小不能超过10MB", http.StatusBadRequest)
			return
		}

		// 创建上传目录（uploadDir 未设置时由 config 设为可执行文件同目录下的 upload，需保证该目录可写）
		uploadPath := filepath.Join(uploadDir, "Purchasereceipt")
		if err := os.MkdirAll(uploadPath, 0755); err != nil {
			jsonErrorUpload(w, "创建上传目录失败: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// 生成唯一文件名：时间戳_原文件名
		timestamp := time.Now().Format("20060102_150405")
		filename := fmt.Sprintf("%s_%s", timestamp, header.Filename)
		filePath := filepath.Join(uploadPath, filename)

		// 保存文件
		dst, err := os.Create(filePath)
		if err != nil {
			jsonErrorUpload(w, "文件保存失败", http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		size, err := io.Copy(dst, file)
		if err != nil {
			jsonErrorUpload(w, "文件写入失败", http.StatusInternalServerError)
			return
		}

		// 生成访问URL
		url := baseURL
		if url == "" {
			url = getBaseURLFromRequestUpload(r)
		} else {
			url = strings.TrimSuffix(url, "/")
		}
		fileURL := fmt.Sprintf("%s/files/Purchasereceipt/%s", url, filename)

		// 返回成功响应
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(UploadResponse{
			Filename: filename,
			URL:      fileURL,
			Size:     size,
		})
	}
}

func jsonErrorUpload(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getBaseURLFromRequestUpload(r *http.Request) string {
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
