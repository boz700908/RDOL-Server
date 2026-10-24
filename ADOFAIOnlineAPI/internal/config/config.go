package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Config 应用配置
type Config struct {
	Server           ServerConfig
	BundlesPath      string
	UploadPath       string
	BaseURL          string
	SteamAPIKey      string // Steam Web API Key，用于校验是否拥有 ADOFAI，空则不启用校验
	NotifyAPIBaseURL string // 审核通知 API 根地址，空则不调用
	DeepSeekAPIKey   string // DeepSeek API Key，空则不启用 AI 对话
	Pan123           Pan123Config
	DB               DBConfig
	SMTP             SMTPConfig
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port string
	Env  string
}

// DBConfig 数据库配置
type DBConfig struct {
	Host     string
	Database string
	User     string
	Password string
	Charset  string
}

// MissingRequiredEnv 返回启用数据库功能所缺少的环境变量名。
func (c DBConfig) MissingRequiredEnv() []string {
	values := map[string]string{
		"DB_HOST": c.Host,
		"DB_NAME": c.Database,
		"DB_USER": c.User,
		"DB_PASS": c.Password,
	}

	missing := make([]string, 0, len(values))
	for _, name := range []string{"DB_HOST", "DB_NAME", "DB_USER", "DB_PASS"} {
		if strings.TrimSpace(values[name]) == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

// Pan123Config 123 云盘 CLI 配置
type Pan123Config struct {
	ParentFileID int64
}

// SMTPConfig 邮箱配置
type SMTPConfig struct {
	Host     string
	Port     int
	Secure   bool
	User     string
	Pass     string
	FromName string
}

// Load 加载配置，优先从环境变量读取，不存在时使用合理默认值（敏感信息无默认值）
func Load() *Config {
	_ = godotenv.Load()

	port := getEnv("PORT", "4004")
	env := getEnv("ENV", "development")

	var execDir string
	if execPath, err := os.Executable(); err == nil {
		execDir = filepath.Dir(execPath)
	}

	bundlesPath := getEnv("BUNDLES_PATH", "")
	if bundlesPath == "" {
		if execDir != "" {
			bundlesPath = filepath.Join(execDir, "bundles")
		} else {
			bundlesPath = "bundles"
		}
	}

	uploadPath := getEnv("UPLOAD_PATH", "")
	if uploadPath == "" {
		if execDir != "" {
			uploadPath = filepath.Join(execDir, "upload")
		} else {
			uploadPath = "upload"
		}
	}

	baseURL := os.Getenv("BASE_URL")

	steamAPIKey := strings.TrimSpace(os.Getenv("STEAM_API_KEY"))

	notifyAPIBaseURL := strings.TrimSpace(os.Getenv("NOTIFY_API_URL"))
	notifyAPIBaseURL = strings.TrimSuffix(notifyAPIBaseURL, "/")

	deepSeekAPIKey := strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY"))

	pan123ParentFileID := int64(0)
	if v := os.Getenv("PAN123_PARENT_FILE_ID"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			pan123ParentFileID = n
		}
	}

	dbHost := strings.TrimSpace(os.Getenv("DB_HOST"))
	dbName := strings.TrimSpace(os.Getenv("DB_NAME"))
	dbUser := strings.TrimSpace(os.Getenv("DB_USER"))
	dbPass := strings.TrimSpace(os.Getenv("DB_PASS"))

	smtpHost := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	smtpPort := 465
	if p := os.Getenv("SMTP_PORT"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			smtpPort = v
		}
	}
	smtpUser := os.Getenv("SMTP_USER")
	smtpPass := os.Getenv("SMTP_PASS")
	smtpFromName := getEnv("SMTP_FROM_NAME", "ADOFAIOnline")

	return &Config{
		Server: ServerConfig{
			Port: port,
			Env:  env,
		},
		BundlesPath:      bundlesPath,
		UploadPath:       uploadPath,
		BaseURL:          baseURL,
		SteamAPIKey:      steamAPIKey,
		NotifyAPIBaseURL: notifyAPIBaseURL,
		DeepSeekAPIKey:   deepSeekAPIKey,
		Pan123: Pan123Config{
			ParentFileID: pan123ParentFileID,
		},
		DB: DBConfig{
			Host:     dbHost,
			Database: dbName,
			User:     dbUser,
			Password: dbPass,
			Charset:  "utf8mb4",
		},
		SMTP: SMTPConfig{
			Host:     smtpHost,
			Port:     smtpPort,
			Secure:   true,
			User:     smtpUser,
			Pass:     smtpPass,
			FromName: smtpFromName,
		},
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
