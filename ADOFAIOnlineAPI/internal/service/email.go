package service

import (
	"crypto/tls"
	"fmt"
	"net/smtp"
	"strings"

	"adofaionlineapi/internal/config"
)

func sendEmail(cfg *config.SMTPConfig, to, subject, body string) error {
	host := cfg.Host
	if idx := strings.Index(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	auth := smtp.PlainAuth("", cfg.User, cfg.Pass, host)

	from := cfg.User
	if cfg.FromName != "" {
		from = fmt.Sprintf("%s <%s>", cfg.FromName, cfg.User)
	}
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		from, to, subject, body)

	addr := fmt.Sprintf("%s:%d", host, cfg.Port)

	if cfg.Secure {
		return sendMailTLS(addr, host, auth, cfg.User, []string{to}, []byte(msg))
	}
	return smtp.SendMail(addr, auth, cfg.User, []string{to}, []byte(msg))
}

func sendMailTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return err
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()

	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	for _, r := range to {
		if err := client.Rcpt(r); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}
