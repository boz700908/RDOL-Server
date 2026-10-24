import nodemailer from 'nodemailer';
import { config, smtpConfigured } from '../config';

const transporter = smtpConfigured()
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    })
  : null;

export async function sendVerifyCode(email: string, code: string): Promise<void> {
  if (!transporter) {
    // 未配置 SMTP：验证码只写日志，方便自建部署时直接取用
    console.log(`[mail] 未配置 SMTP，验证码不发送。email=${email} code=${code}`);
    return;
  }

  await transporter.sendMail({
    from: `"${config.smtp.fromName}" <${config.smtp.user}>`,
    to: email,
    subject: '验证码',
    html: `<p>您的验证码是：<strong>${code}</strong></p><p>有效期10分钟，请勿泄露给他人。</p>`
  });
}
