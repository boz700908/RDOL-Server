import crypto from 'crypto';

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
