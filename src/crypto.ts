// AES-GCM 敏感字段加密工具
// 使用 Web Crypto API,主密钥从 wrangler secret 注入
// 密钥经 SHA-256 派生,支持任意长度输入
//
// 密文格式: "enc:v1:" + base64(iv(12B) + ciphertext)
// 加前缀后可区分"未加密旧数据"与"密钥不匹配的密文",避免密文被当明文使用

const ENC_PREFIX = 'enc:v1:';

export async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // 先用 SHA-256 派生 32 字节密钥(兼容任意长度的输入字符串)
  // 注:此处的派生用于将任意长度输入归一化为 32 字节,不是密码学 KDF
  // 若 ENCRYPTION_KEY 是高熵随机串(文档建议 openssl rand -base64 32),安全性等价于直接用 AES-256
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(encryptionKey));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  return keyMaterial;
}

export async function encrypt(plaintext: string, encryptionKey: string): Promise<string> {
  if (!encryptionKey) {
    // 未配置加密密钥:生产环境应直接拒绝,这里仅在开发环境兜底并明确警告
    // 日志含明文长度提示,不含明文内容
    console.warn('[crypto] ENCRYPTION_KEY 未配置,敏感字段将以明文存储(仅开发环境允许)');
    return plaintext;
  }
  const key = await deriveKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  // 拼接 iv + ciphertext,再 base64 编码,加前缀标记
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  // 分块拼接避免 spread 栈溢出
  let binStr = '';
  for (let i = 0; i < combined.length; i++) binStr += String.fromCharCode(combined[i]);
  return ENC_PREFIX + btoa(binStr);
}

export async function decrypt(encrypted: string, encryptionKey: string): Promise<string> {
  // 1. 无加密密钥:若是加密格式说明密钥刚被移除,不能当明文用;否则按明文返回
  if (!encryptionKey) {
    if (encrypted && encrypted.startsWith(ENC_PREFIX)) {
      throw new Error('密文存在但 ENCRYPTION_KEY 未配置,无法解密');
    }
    return encrypted;
  }
  // 2. 不带前缀:旧版明文数据,原样返回
  if (!encrypted || !encrypted.startsWith(ENC_PREFIX)) {
    return encrypted;
  }
  // 3. 带前缀:解密,失败抛错(不再静默返回密文,避免密文被当明文使用导致凭证损坏)
  try {
    const b64 = encrypted.slice(ENC_PREFIX.length);
    const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (combined.length < 13) {
      throw new Error('密文长度异常');
    }
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const key = await deriveKey(encryptionKey);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    // 解密失败原因:密钥不匹配(ENCRYPTION_KEY 已变更)/ 密文损坏
    // 抛错让上层决定降级策略(如清空凭证并告警),而非把密文当明文使用
    throw new Error('解密失败:密钥不匹配或密文损坏 (' + (e instanceof Error ? e.message : 'unknown') + ')');
  }
}

// 判断字符串是否是加密格式(带前缀)
export function isEncrypted(s: string): boolean {
  return !!s && s.startsWith(ENC_PREFIX);
}
