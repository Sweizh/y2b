// AES-GCM 敏感字段加密工具
// 使用 Web Crypto API，主密钥从 wrangler secret 注入
// 密钥经 SHA-256 派生，支持任意长度输入

export async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // 先用 SHA-256 派生 32 字节密钥（兼容任意长度的输入字符串）
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
    // 未配置加密密钥时直接返回明文（开发环境兜底，生产环境必须配置）
    console.warn('[crypto] ENCRYPTION_KEY 未配置，敏感字段以明文存储');
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
  // 拼接 iv + ciphertext，再 base64 编码
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(encrypted: string, encryptionKey: string): Promise<string> {
  if (!encryptionKey) return encrypted;
  // 兼容未加密的旧数据：若不是 base64 或解密失败，原样返回
  try {
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    if (combined.length < 13) return encrypted; // 太短，肯定不是加密数据
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
    // 解密失败，可能是未加密的旧数据，原样返回
    return encrypted;
  }
}

// 判断字符串是否是加密格式（base64 且长度合理）
export function isEncrypted(s: string): boolean {
  if (!s) return false;
  try {
    const combined = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    return combined.length >= 13;
  } catch {
    return false;
  }
}
