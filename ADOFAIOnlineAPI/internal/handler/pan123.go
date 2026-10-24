package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"os"

	"adofaionlineapi/internal/pan123"
)

// Pan123Upload 上传文件到 123 云盘（使用 pan123 CLI）
// POST /pan123/upload，multipart/form-data 字段 file
func Pan123Upload(parentFileID int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodOptions {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "Method not allowed"})
			return
		}

		if err := r.ParseMultipartForm(1 << 30); err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "请求体过大或格式错误"})
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "请选择要上传的文件"})
			return
		}
		defer file.Close()

		filename := header.Filename

		tmp, err := os.CreateTemp("", "pan123-upload-*")
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "创建临时文件失败"})
			return
		}
		tmpPath := tmp.Name()
		defer os.Remove(tmpPath)
		if _, err := io.Copy(tmp, file); err != nil {
			tmp.Close()
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "读取文件失败"})
			return
		}
		if err := tmp.Close(); err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "关闭临时文件失败"})
			return
		}

		downloadURL, fileID, err := pan123.UploadTo123(parentFileID, tmpPath, filename)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"download_url": downloadURL,
			"file_id":      fileID,
		})
	}
}
