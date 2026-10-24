package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

const deepSeekBaseURL = "https://api.deepseek.com"

// DeepSeekChat 代理请求到 DeepSeek 对话 API（与 OpenAI 兼容格式）
// POST /ai/chat  需要登录
// 请求体与 OpenAI chat completions 兼容：model, messages, stream 等
func DeepSeekChat(apiKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorDeepSeek(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(apiKey) == "" {
			jsonErrorDeepSeek(w, "AI 服务未配置", http.StatusServiceUnavailable)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			jsonErrorDeepSeek(w, "读取请求体失败", http.StatusBadRequest)
			return
		}
		r.Body.Close()

		req, err := http.NewRequest(http.MethodPost, deepSeekBaseURL+"/chat/completions", bytes.NewReader(body))
		if err != nil {
			jsonErrorDeepSeek(w, "创建请求失败", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+apiKey)

		client := &http.Client{Timeout: 120 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			jsonErrorDeepSeek(w, "请求 DeepSeek 失败: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		// 拷贝响应头
		for k, v := range resp.Header {
			if strings.EqualFold(k, "Content-Length") {
				continue
			}
			for _, vv := range v {
				w.Header().Add(k, vv)
			}
		}
		w.WriteHeader(resp.StatusCode)

		// 流式：直接拷贝 body；非流式：同样拷贝
		io.Copy(w, resp.Body)
	}
}

func jsonErrorDeepSeek(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
