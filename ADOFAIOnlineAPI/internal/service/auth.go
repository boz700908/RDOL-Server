package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"adofaionlineapi/internal/config"
	"golang.org/x/crypto/bcrypt"
)

// 所有错误信息直接在函数中返回，使用中文便于理解

// AuthService 认证服务
type AuthService struct {
	db   *sql.DB
	smtp *config.SMTPConfig
}

// NewAuthService 创建认证服务
func NewAuthService(db *sql.DB, smtp *config.SMTPConfig) *AuthService {
	return &AuthService{db: db, smtp: smtp}
}

// SendRegisterCode 发送注册验证码
func (s *AuthService) SendRegisterCode(ctx context.Context, email string) error {
	domain := emailDomain(email)
	if domain == "" {
		return errors.New("仅支持163、QQ邮箱注册")
	}
	if !isEmailDomainAllowed(domain) {
		return errors.New("仅支持163、QQ邮箱注册")
	}
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM banned_email_domains WHERE domain = ? LIMIT 1`, domain).Scan(&n); err == nil {
		return errors.New("该邮箱域名已被禁止注册")
	}
	code := generateCode(6)
	expiresAt := time.Now().Add(10 * time.Minute)

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO email_codes (email, code, type, expires_at) VALUES (?, ?, 1, ?)`,
		email, code, expiresAt)
	if err != nil {
		return errors.New("验证码保存失败")
	}

	if err := sendEmail(s.smtp, email, "注册验证码", fmt.Sprintf("您的注册验证码是：%s，10分钟内有效。", code)); err != nil {
		return errors.New("邮件发送失败，请检查邮箱地址")
	}
	
	return nil
}

// Register 注册（需邮箱验证码，注册后 status=0 封禁，role=1 普通用户）
func (s *AuthService) Register(ctx context.Context, username, password, email, code string) error {
	// 检查邮箱域名是否允许（仅 163、QQ）
	domain := emailDomain(email)
	if domain == "" {
		return errors.New("仅支持163、QQ邮箱注册")
	}
	if !isEmailDomainAllowed(domain) {
		return errors.New("仅支持163、QQ邮箱注册")
	}
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM banned_email_domains WHERE domain = ? LIMIT 1`, domain).Scan(&n); err == nil {
		return errors.New("该邮箱域名已被禁止注册")
	}

	// 检查用户名是否已存在
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM users WHERE username = ?`, username).Scan(&exists); err == nil {
		return errors.New("用户名已存在")
	}

	// 检查邮箱是否已存在
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM users WHERE email = ?`, email).Scan(&exists); err == nil {
		return errors.New("邮箱已被注册")
	}

	// 验证码校验（不区分大小写）
	var dbCode string
	var expiresAt time.Time
	var used int
	err := s.db.QueryRowContext(ctx,
		`SELECT code, expires_at, used FROM email_codes WHERE email = ? AND type = 1 ORDER BY id DESC LIMIT 1`,
		email).Scan(&dbCode, &expiresAt, &used)
	if err == sql.ErrNoRows {
		return errors.New("请先获取验证码")
	}
	if err != nil {
		return errors.New("验证码查询失败")
	}
	
	if used != 0 {
		return errors.New("验证码已被使用，请重新获取")
	}
	if time.Now().After(expiresAt) {
		return errors.New("验证码已过期，请重新获取")
	}
	if !equalIgnoreCase(dbCode, code) {
		return errors.New("验证码错误")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return errors.New("密码加密失败")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("数据库事务启动失败")
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx,
		`UPDATE email_codes SET used = 1 WHERE email = ? AND type = 1 AND code = ?`, email, code)
	if err != nil {
		return errors.New("验证码标记失败")
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO users (username, email, password, role, status) VALUES (?, ?, ?, 1, 0)`,
		username, email, string(hashed))
	if err != nil {
		return errors.New("用户创建失败")
	}

	if err := tx.Commit(); err != nil {
		return errors.New("注册提交失败")
	}
	
	return nil
}

// Login 登录，返回 token
func (s *AuthService) Login(ctx context.Context, usernameOrEmail, password string) (string, int64, error) {
	var id int64
	var hashed string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, password FROM users WHERE username = ? OR email = ?`,
		usernameOrEmail, usernameOrEmail).Scan(&id, &hashed)
	if err == sql.ErrNoRows {
		return "", 0, errors.New("用户名或密码错误")
	}
	if err != nil {
		return "", 0, errors.New("用户查询失败")
	}
	// 封禁账号也允许登录，仅限制部分功能（如设备码绑定等）
	if err := bcrypt.CompareHashAndPassword([]byte(hashed), []byte(password)); err != nil {
		return "", 0, errors.New("用户名或密码错误")
	}

	token := generateToken()
	expiresAt := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Second)

	_, err = s.db.ExecContext(ctx,
		`UPDATE users SET token = ?, token_expires_at = ? WHERE id = ?`,
		token, expiresAt, id)
	if err != nil {
		return "", 0, errors.New("Token生成失败")
	}

	return token, id, nil
}

// equalIgnoreCase 不区分大小写比较字符串
func equalIgnoreCase(a, b string) bool {
	return strings.EqualFold(a, b)
}
