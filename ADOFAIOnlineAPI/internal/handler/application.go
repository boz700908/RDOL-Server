package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"adofaionlineapi/internal/middleware"
	"adofaionlineapi/internal/notify"
)

// SubmitApplicationReq 提交申请请求
type SubmitApplicationReq struct {
	SteamLink      string   `json:"steam_link"`
	ScreenshotURLs []string `json:"screenshot_urls"`
}

// SubmitApplicationResp 提交申请响应
type SubmitApplicationResp struct {
	ID int64 `json:"id"`
}

// Application 申请信息
type Application struct {
	ID             int64    `json:"id"`
	UserID         int64    `json:"user_id"`
	SteamLink      string   `json:"steam_link"`
	ScreenshotURLs []string `json:"screenshot_urls"`
	Status         int      `json:"status"`
	RejectReason   string   `json:"reject_reason,omitempty"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	ReviewedBy     *int64   `json:"reviewed_by,omitempty"`
	ReviewedAt     *string  `json:"reviewed_at,omitempty"`
}

// SubmitApplication 提交正版验证申请
// POST /applications/submit
func SubmitApplication(db *sql.DB, notifyBaseURL, steamAPIKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonErrorApp(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取用户ID
		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorApp(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		// 解析请求
		var req SubmitApplicationReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonErrorApp(w, "请求格式错误", http.StatusBadRequest)
			return
		}

		// 检查是否已绑定 QQ
		var qq sql.NullString
		if err := db.QueryRow(`SELECT qq FROM users WHERE id = ?`, userID).Scan(&qq); err != nil || !qq.Valid || strings.TrimSpace(qq.String) == "" {
			jsonErrorApp(w, "请先绑定QQ后再提交申请", http.StatusBadRequest)
			return
		}

		// 验证：至少有一个字段非空
		req.SteamLink = strings.TrimSpace(req.SteamLink)
		if req.SteamLink == "" && len(req.ScreenshotURLs) == 0 {
			jsonErrorApp(w, "Steam链接和购买截图至少需要提供一个", http.StatusBadRequest)
			return
		}

		// 验证：截图最多4张
		if len(req.ScreenshotURLs) > 4 {
			jsonErrorApp(w, "购买截图最多只能上传4张", http.StatusBadRequest)
			return
		}

		// 检查用户是否有审核中或已通过的申请
		var existingStatus int
		err := db.QueryRow(
			`SELECT status FROM verification_applications WHERE user_id = ? AND status IN (0, 1) LIMIT 1`,
			userID).Scan(&existingStatus)

		if err == nil {
			// 找到了审核中或已通过的申请
			if existingStatus == 0 {
				jsonErrorApp(w, "您已有申请正在审核中，请等待审核结果", http.StatusBadRequest)
				return
			} else if existingStatus == 1 {
				jsonErrorApp(w, "您的申请已通过，无需重复提交", http.StatusBadRequest)
				return
			}
		} else if err != sql.ErrNoRows {
			jsonErrorApp(w, "查询申请状态失败", http.StatusInternalServerError)
			return
		}

		// 如果提供了 Steam 链接，优先用 Steam API 校验是否拥有《冰与火之舞》（APPID: 977950）
		if req.SteamLink != "" {
			owns, err := checkSteamGameOwnership(r.Context(), steamAPIKey, req.SteamLink)
			if err != nil {
				// 校验失败 => 提示用户检查链接或稍后再试，由用户修正后重新提交
				jsonErrorApp(w, "无法验证 Steam 游戏拥有情况，请检查链接或稍后重试："+err.Error(), http.StatusBadRequest)
				return
			}
			if !owns {
				// 明确告诉用户拒绝原因
				jsonErrorApp(w, "Steam链接没有冰与火之舞", http.StatusBadRequest)
				return
			}
		}

		// 将截图URL数组转为JSON
		screenshotJSON := "[]"
		if len(req.ScreenshotURLs) > 0 {
			jsonBytes, err := json.Marshal(req.ScreenshotURLs)
			if err != nil {
				jsonErrorApp(w, "截图数据处理失败", http.StatusInternalServerError)
				return
			}
			screenshotJSON = string(jsonBytes)
		}

		// 插入申请
		steamLink := sql.NullString{String: req.SteamLink, Valid: req.SteamLink != ""}
		result, err := db.Exec(
			`INSERT INTO verification_applications (user_id, steam_link, screenshot_urls, status) VALUES (?, ?, ?, 0)`,
			userID, steamLink, screenshotJSON)

		if err != nil {
			jsonErrorApp(w, "提交申请失败", http.StatusInternalServerError)
			return
		}

		id, _ := result.LastInsertId()

		// 通知审核插件：有新申请待审核
		notify.NewApply(notifyBaseURL)

		// 返回申请ID
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(SubmitApplicationResp{ID: id})
	}
}

// GetMyApplications 获取我的申请记录
// GET /applications/my
func GetMyApplications(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			jsonErrorApp(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 获取用户ID
		userID, ok := middleware.GetUserID(r)
		if !ok {
			jsonErrorApp(w, "用户信息获取失败", http.StatusInternalServerError)
			return
		}

		// 查询用户的所有申请
		rows, err := db.Query(
			`SELECT id, user_id, steam_link, screenshot_urls, status, reject_reason, 
			        created_at, updated_at, reviewed_by, reviewed_at 
			 FROM verification_applications 
			 WHERE user_id = ? 
			 ORDER BY created_at DESC`,
			userID)

		if err != nil {
			jsonErrorApp(w, "查询申请记录失败", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		applications := []Application{}
		for rows.Next() {
			var app Application
			var steamLink sql.NullString
			var screenshotJSON string
			var rejectReason sql.NullString
			var reviewedBy sql.NullInt64
			var reviewedAt sql.NullString

			err := rows.Scan(
				&app.ID, &app.UserID, &steamLink, &screenshotJSON, &app.Status,
				&rejectReason, &app.CreatedAt, &app.UpdatedAt, &reviewedBy, &reviewedAt)

			if err != nil {
				continue
			}

			// 处理可空字段
			if steamLink.Valid {
				app.SteamLink = steamLink.String
			}
			if rejectReason.Valid {
				app.RejectReason = rejectReason.String
			}
			if reviewedBy.Valid {
				app.ReviewedBy = &reviewedBy.Int64
			}
			if reviewedAt.Valid {
				app.ReviewedAt = &reviewedAt.String
			}

			// 解析截图URL数组
			if screenshotJSON != "" {
				json.Unmarshal([]byte(screenshotJSON), &app.ScreenshotURLs)
			}
			if app.ScreenshotURLs == nil {
				app.ScreenshotURLs = []string{}
			}

			applications = append(applications, app)
		}

		// 返回申请列表
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(applications)
	}
}

func jsonErrorApp(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ---------------- Steam 游戏拥有校验 ----------------

const adoFAIAppID = 977950

var (
	profileIDRegexp = regexp.MustCompile(`steamcommunity\.com/profiles/(\d{17})`)
	vanityIDRegexp  = regexp.MustCompile(`steamcommunity\.com/id/([^/]+)/?`)
)

// checkSteamGameOwnership 检查给定 Steam 链接或 ID 是否拥有《冰与火之舞》
func checkSteamGameOwnership(ctx context.Context, apiKey, input string) (bool, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return false, errors.New("Steam API Key 未配置")
	}

	input = strings.TrimSpace(input)
	if input == "" {
		return false, errors.New("Steam 链接不能为空")
	}

	steamID, err := extractSteamID(input)
	if err != nil {
		return false, err
	}

	// 如果是自定义 ID，需要先解析为 SteamID64
	if steamID == "" {
		vanity := extractVanityID(input)
		if vanity == "" {
			return false, errors.New("无法从 Steam 链接中解析出 Steam ID，请检查格式")
		}
		steamID, err = resolveVanityURL(ctx, apiKey, vanity)
		if err != nil {
			return false, err
		}
		if steamID == "" {
			return false, errors.New("无法解析自定义 Steam ID，请确认链接有效")
		}
	}

	return hasGame(ctx, apiKey, steamID, adoFAIAppID)
}

// extractSteamID 尝试直接从输入中提取 SteamID64
func extractSteamID(input string) (string, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", errors.New("输入为空")
	}

	if m := profileIDRegexp.FindStringSubmatch(input); len(m) == 2 {
		return m[1], nil
	}

	// 直接输入 SteamID64
	if _, err := strconv.ParseInt(input, 10, 64); err == nil && len(input) == 17 {
		return input, nil
	}

	// 其他情况（如自定义 ID 链接）返回空，由上层去解析 vanity
	return "", nil
}

// extractVanityID 从链接中提取自定义 ID（/id/xxx 部分）
func extractVanityID(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	if m := vanityIDRegexp.FindStringSubmatch(input); len(m) == 2 {
		return m[1]
	}
	return ""
}

// resolveVanityURL 调用 Steam API 将自定义 ID 解析为 SteamID64
func resolveVanityURL(ctx context.Context, apiKey, vanity string) (string, error) {
	const resolveURL = "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/"

	values := url.Values{}
	values.Set("key", apiKey)
	values.Set("vanityurl", vanity)

	type resolveResp struct {
		Response struct {
			Success int    `json:"success"`
			SteamID string `json:"steamid"`
			Message string `json:"message"`
		} `json:"response"`
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()

		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, resolveURL+"?"+values.Encode(), nil)
		if err != nil {
			return "", err
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(2 * time.Second)
			continue
		}

		func() {
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				lastErr = errors.New("Steam ResolveVanityURL 返回状态码 " + strconv.Itoa(resp.StatusCode))
				return
			}

			var data resolveResp
			if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
				lastErr = err
				return
			}

			if data.Response.Success == 1 && data.Response.SteamID != "" {
				lastErr = nil
				vanityID := data.Response.SteamID
				steamID := strings.TrimSpace(vanityID)
				if steamID == "" {
					lastErr = errors.New("Steam 返回了空的 SteamID")
					return
				}
				// 覆盖外层返回
				vanity = steamID
			} else {
				if data.Response.Message != "" {
					lastErr = errors.New(data.Response.Message)
				} else {
					lastErr = errors.New("无法解析自定义 Steam ID")
				}
			}
		}()

		if lastErr == nil {
			return vanity, nil
		}
	}

	if lastErr != nil {
		return "", lastErr
	}

	return "", errors.New("无法解析自定义 Steam ID")
}

// hasGame 调用 GetOwnedGames 检查是否拥有指定 APPID
func hasGame(ctx context.Context, apiKey, steamID string, appID int) (bool, error) {
	const ownedGamesURL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"

	values := url.Values{}
	values.Set("key", apiKey)
	values.Set("steamid", steamID)
	values.Set("include_appinfo", "1")
	values.Set("include_played_free_games", "1")
	// appids_filter[0]=APPID
	values.Set("appids_filter[0]", strconv.Itoa(appID))

	type game struct {
		AppID int `json:"appid"`
	}
	type ownedResp struct {
		Response struct {
			Games []game `json:"games"`
		} `json:"response"`
	}

	var lastErr error
	found := false
	for attempt := 0; attempt < 3; attempt++ {
		reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()

		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, ownedGamesURL+"?"+values.Encode(), nil)
		if err != nil {
			return false, err
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(2 * time.Second)
			continue
		}

		func() {
			defer resp.Body.Close()

			// 若 API Key 无效或游戏库为私密，Steam 可能返回 403
			if resp.StatusCode == http.StatusForbidden {
				lastErr = errors.New("Steam API 返回 403，API Key 无效或用户游戏库为私密")
				return
			}

			if resp.StatusCode != http.StatusOK {
				lastErr = errors.New("Steam GetOwnedGames 返回状态码 " + strconv.Itoa(resp.StatusCode))
				return
			}

			var data ownedResp
			if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
				lastErr = err
				return
			}

			for _, g := range data.Response.Games {
				if g.AppID == appID {
					found = true
					lastErr = nil
					return
				}
			}

			// 成功调用但未找到游戏 => 明确返回未拥有
			lastErr = nil
		}()

		if lastErr == nil {
			// 调用成功（无论是否找到游戏），不再重试
			break
		}
	}

	if lastErr != nil {
		return false, lastErr
	}

	return found, nil
}

// CheckSteamOwnershipHandler 调试接口：通过查询参数 ?link= 直接验证是否拥有冰与火之舞
// GET /debug/check-steam-ownership?link=...
func CheckSteamOwnershipHandler(steamAPIKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")

		link := strings.TrimSpace(r.URL.Query().Get("link"))
		if link == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "缺少 link 查询参数，例如 /debug/check-steam-ownership?link=https://steamcommunity.com/profiles/xxxxxxxxxxxxxxxxx/",
			})
			return
		}

		owns, err := checkSteamGameOwnership(r.Context(), steamAPIKey, link)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"owns":  false,
				"error": err.Error(),
			})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"owns": owns,
		})
	}
}
