package service

import (
	"crypto/rand"
	"encoding/hex"
	"math/big"
	"strings"
)

// emailDomain 从邮箱地址提取域名（@ 后的部分），小写返回，无效返回空字符串
func emailDomain(email string) string {
	email = strings.TrimSpace(email)
	i := strings.LastIndex(email, "@")
	if i < 0 || i == len(email)-1 {
		return ""
	}
	return strings.ToLower(email[i+1:])
}

// allowedEmailDomains 注册仅允许的邮箱域名（163、QQ）
var allowedEmailDomains = map[string]bool{
	"163.com": true,
	"qq.com":  true,
}

// isEmailDomainAllowed 域名是否在注册白名单内
func isEmailDomainAllowed(domain string) bool {
	return allowedEmailDomains[strings.ToLower(strings.TrimSpace(domain))]
}

const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generateCode(length int) string {
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		b[i] = charset[n.Int64()]
	}
	return string(b)
}

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
