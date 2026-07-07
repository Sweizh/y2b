// KV 读写封装 + 配置/频道/状态/队列/去重表的统一访问层

import { encrypt, decrypt } from './crypto';

export interface Config {
  admin_password?: string;          // bcrypt 哈希
  pipeline_token?: string;         // 32 字节随机 token
  initialized?: boolean;
  // B 站凭证
  bili_sessdata?: string;
  bili_jct?: string;
  bili_buvid3?: string;
  ac_time_value?: string;
  // YouTube
  yt_api_key?: string;
  yt_cookies?: string;
  // GitHub
  gh_token?: string;
  gh_repo?: string;
  // ASR
  asr_api?: string;
  asr_key?: string;
  // 翻译
  translate_api?: string;
  translate_key?: string;
  // 通知
  notify_webhook?: string;
}

export interface Channel {
  id: string;
  channel_id: string;
  name: string;
  season_id?: string;
  section_id?: string;
  tid?: number;
  tags?: string;
  copyright?: 1 | 2;       // 1=自制 2=转载
  subtitle_mode?: 'translated' | 'original' | 'both' | 'none';
  enabled?: boolean;
  created_at?: number;
}

export interface ProcessedItem {
  video_id: string;
  bvid?: string;
  title?: string;
  channel?: string;
  channel_id?: string;
  status: 'success' | 'failed';
  stage?: string;            // 中断阶段
  message?: string;          // 失败原因
  processed_at: number;
}

export interface ManualQueueItem {
  video_id: string;
  url?: string;
  title?: string;
  channel_config_id?: string;
  config?: Partial<Channel>;
  added_at: number;
  status: 'pending' | 'processing' | 'retry';
  retry_count?: number;
  last_error?: string;
}

export interface StatusRecord {
  last_run_at?: number;
  total_processed?: number;
  recent_records?: Array<{
    channel: string;
    video_title: string;
    status: 'success' | 'failed';
    stage?: string;
    message?: string;
    processed_at: number;
  }>;
  system_status?: 'normal' | 'degraded' | 'error';
  cookie_status?: 'ok' | 'expired' | 'unknown';
}

const KEYS = {
  config: 'config',
  channels: 'channels',
  manual_queue: 'manual_queue',
  processed: 'processed',
  status: 'status',
} as const;

// 敏感字段列表：存储时加密，读取时解密
const SENSITIVE_FIELDS: (keyof Config)[] = [
  'bili_sessdata', 'bili_jct', 'bili_buvid3', 'ac_time_value',
  'yt_api_key', 'yt_cookies', 'gh_token', 'asr_key', 'translate_key',
];

// 脱敏字段列表：GET /api/config 返回时打码
const MASK_FIELDS: (keyof Config)[] = [
  'admin_password', 'bili_sessdata', 'bili_jct', 'bili_buvid3', 'ac_time_value',
  'yt_api_key', 'yt_cookies', 'gh_token', 'asr_key', 'translate_key',
];

function mask(value: string): string {
  if (!value || value.length < 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

export async function getRawConfig(kv: KVNamespace, encryptionKey: string): Promise<Config> {
  const raw = await kv.get(KEYS.config);
  if (!raw) return {};
  try {
    const cfg = JSON.parse(raw) as Config;
    // 解密敏感字段
    const result: any = { ...cfg };
    for (const field of SENSITIVE_FIELDS) {
      if (result[field]) {
        result[field] = await decrypt(result[field] as string, encryptionKey);
      }
    }
    return result as Config;
  } catch {
    return {};
  }
}

export async function putConfig(kv: KVNamespace, cfg: Config, encryptionKey: string): Promise<void> {
  const stored: any = { ...cfg };
  // 加密敏感字段
  for (const field of SENSITIVE_FIELDS) {
    if (stored[field]) {
      stored[field] = await encrypt(stored[field] as string, encryptionKey);
    }
  }
  await kv.put(KEYS.config, JSON.stringify(stored));
}

// 返回给前端的脱敏版本
export function maskConfig(cfg: Config): Config {
  const masked: any = { ...cfg };
  for (const field of MASK_FIELDS) {
    if (masked[field]) {
      masked[field] = mask(masked[field] as string);
    }
  }
  // admin_password 完全不返回给前端
  delete masked.admin_password;
  return masked as Config;
}

export async function getChannels(kv: KVNamespace): Promise<Channel[]> {
  const raw = await kv.get(KEYS.channels);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Channel[];
  } catch {
    return [];
  }
}

export async function putChannels(kv: KVNamespace, channels: Channel[]): Promise<void> {
  await kv.put(KEYS.channels, JSON.stringify(channels));
}

export async function getManualQueue(kv: KVNamespace): Promise<ManualQueueItem[]> {
  const raw = await kv.get(KEYS.manual_queue);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ManualQueueItem[];
  } catch {
    return [];
  }
}

export async function putManualQueue(kv: KVNamespace, queue: ManualQueueItem[]): Promise<void> {
  await kv.put(KEYS.manual_queue, JSON.stringify(queue));
}

export async function getProcessed(kv: KVNamespace): Promise<Record<string, ProcessedItem>> {
  const raw = await kv.get(KEYS.processed);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, ProcessedItem>;
  } catch {
    return {};
  }
}

export async function putProcessed(kv: KVNamespace, processed: Record<string, ProcessedItem>): Promise<void> {
  // 裁剪：保留最近 500 条
  const entries = Object.entries(processed);
  if (entries.length > 500) {
    entries.sort((a, b) => (b[1].processed_at || 0) - (a[1].processed_at || 0));
    const trimmed = Object.fromEntries(entries.slice(0, 500));
    await kv.put(KEYS.processed, JSON.stringify(trimmed));
  } else {
    await kv.put(KEYS.processed, JSON.stringify(processed));
  }
}

export async function getStatus(kv: KVNamespace): Promise<StatusRecord> {
  const raw = await kv.get(KEYS.status);
  if (!raw) return { system_status: 'normal', recent_records: [] };
  try {
    return JSON.parse(raw) as StatusRecord;
  } catch {
    return { system_status: 'normal', recent_records: [] };
  }
}

export async function putStatus(kv: KVNamespace, status: StatusRecord): Promise<void> {
  // 裁剪：保留最近 100 条
  if (status.recent_records && status.recent_records.length > 100) {
    status.recent_records = status.recent_records
      .sort((a, b) => b.processed_at - a.processed_at)
      .slice(0, 100);
  }
  await kv.put(KEYS.status, JSON.stringify(status));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
