package notify

import (
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const clientTimeout = 10 * time.Second

// NewApply 通知「有新申请待审核」，GET {baseURL}/adofai/new_apply。非阻塞，失败仅打日志。
func NewApply(baseURL string) {
	if baseURL == "" {
		return
	}
	go doGet(baseURL + "/adofai/new_apply")
}

// ApplyResult 通知「申请通过/拒绝」，GET {baseURL}/adofai/apply_result?user_id=xxx&result=approve|reject。非阻塞，失败仅打日志。
func ApplyResult(baseURL string, userID int64, approved bool) {
	if baseURL == "" {
		return
	}
	result := "reject"
	if approved {
		result = "approve"
	}
	u := baseURL + "/adofai/apply_result?user_id=" + url.QueryEscape(strconv.FormatInt(userID, 10)) + "&result=" + url.QueryEscape(result)
	go doGet(u)
}

func doGet(rawURL string) {
	client := &http.Client{Timeout: clientTimeout}
	resp, err := client.Get(rawURL)
	if err != nil {
		log.Printf("[notify] GET %s: %v", rawURL, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("[notify] GET %s: status %d", rawURL, resp.StatusCode)
	}
}
